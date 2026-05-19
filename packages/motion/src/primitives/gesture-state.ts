import { type AnimationPlaybackControls, animate, isMotionValue, type MotionValue } from "motion"
import { type Accessor, createEffect, createMemo, onCleanup, untrack } from "solid-js"
import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import { getMotionDefault } from "../default-values"
import { shouldReduceMotion } from "../reduced-motion"
import type {
  AnimateValue,
  MotionConfigContextValue,
  MotionElement,
  MotionOptions,
  ResolvedValues,
  Target,
  Transition,
  VariantContextValue,
} from "../types"
import { asVariantLabels, mergeTransition, resolveTarget } from "./createMotion"

// ---------------------------------------------------------------------------
// Solid-native fine-grained gesture state machine (ADR 0002).
//
// Implements three of the four jobs motion's createAnimationState handles:
//   1. Priority resolution — high-to-low among active states
//   2. Per-key handoff — when a higher-priority state deactivates, lower-priority
//      states (or fallbacks) take over each key it was animating
//   3. Variant resolution — reuses Phase 1's resolveTarget for label→Target lookup
//
// Job 4 (parent-child variant inheritance via variantChildren) is handled
// reactively through Phase 1's VariantContext + Q4's active-gated label slots,
// NOT via this state machine — keeping the inheritance tree Solid-owned.
// ---------------------------------------------------------------------------

/** State names, ordered low → high priority. Matches motion-dom's variantPriorityOrder. */
const STATE_NAMES = [
  "animate",
  "whileInView",
  "whileHover",
  "whilePress",
  "whileFocus",
  "whileDrag",
  "exit",
] as const

export type GestureStateName = (typeof STATE_NAMES)[number]

/** High → low priority for the winners walk. Materialized once. */
const PRIORITY_HIGH_TO_LOW: readonly GestureStateName[] = [...STATE_NAMES].reverse()

/** A key's resolved value plus the (optional) per-target transition that produced it. */
type WinnerEntry = {
  value: unknown
  transition: Transition | undefined
  /** Which state contributed this key — used by the diff effect's onAnimationComplete bookkeeping. */
  stateName: GestureStateName
}

export type SetActive = (state: GestureStateName, isActive: boolean) => void

/** The reactive store of active gesture flags, lifted to the caller for sharing. */
export type ActiveStore = Store<Record<GestureStateName, boolean>>
export type SetActiveStore = SetStoreFunction<Record<GestureStateName, boolean>>
export type ActiveStoreTuple = [ActiveStore, SetActiveStore]

export type CreateGestureStateMachineDeps = {
  el: MotionElement
  getOpts: () => MotionOptions
  parentVariantCtx: VariantContextValue
  motionConfig: MotionConfigContextValue
  systemReducedMotion: Accessor<boolean>
  /** Captured at construction. Used as the first stop in the removed-key fallback chain (Q7). */
  initialTarget: Target | null
  /**
   * Optional external active store (Q4 — useMotion lifts this up so its
   * `myVariantCtx` can read the same flags it propagates to descendants).
   * When omitted, the state machine creates its own internal store —
   * backward-compatible for `createMotion` direct users.
   */
  externalActiveStore?: ActiveStoreTuple
}

export type GestureStateMachine = {
  /** Imperatively toggle a gesture state. Triggers re-resolution + animate(). */
  setActive: SetActive
}

/**
 * Construct the per-element gesture state machine.
 *
 * Wired primitives:
 * - `createStore` for the seven active flags — Solid tracks per-path, so
 *   toggling `whileHover` doesn't dirty memos reading `whilePress`.
 * - `createMemo` for `stateTargets` — cached, re-runs only when opts/parent
 *   context change.
 * - `createMemo` for `winners` — same caching, re-runs when `active` flags or
 *   `stateTargets` change.
 * - `createEffect` for the diff-and-animate loop — fires on `winners` change;
 *   compares against `lastApplied` to compute changed/removed keys.
 * - `onCleanup` inside the effect for per-iteration MV subscriptions — scoped
 *   to each effect run (fires on re-run AND owner disposal). Same iteration-
 *   scoped cleanup pattern Phase 1 established.
 */
export function createGestureStateMachine(
  deps: CreateGestureStateMachineDeps,
): GestureStateMachine {
  const {
    el,
    getOpts,
    parentVariantCtx,
    motionConfig,
    systemReducedMotion,
    initialTarget,
    externalActiveStore,
  } = deps

  // ---------- Active flags ----------
  // `animate` defaults true: it's the baseline state (mirrors motion's
  // createTypeState(true) for animate). All other states start inactive.
  // If the caller provided an external store (Q4 — useMotion lifts this up
  // so myVariantCtx can read the same flags), reuse it; else create our own.
  const [active, setActiveStore] =
    externalActiveStore ??
    createStore<Record<GestureStateName, boolean>>({
      animate: true,
      whileInView: false,
      whileHover: false,
      whilePress: false,
      whileFocus: false,
      whileDrag: false,
      exit: false,
    })

  // ---------- Per-state resolved targets ----------
  // createMemo (not createComputed): reads only run when opts/parent change,
  // and the value is cached for downstream consumers. The animate call is
  // frame-async tolerant — the side-effect createEffect below handles timing.
  const stateTargets = createMemo<Record<GestureStateName, Target | null>>(() => {
    const opts = getOpts()
    const variants = opts.variants
    const custom = opts.custom ?? parentVariantCtx.custom?.()
    return {
      animate: resolveTarget(
        opts.animate,
        variants,
        asVariantLabels(parentVariantCtx.animate?.()),
        custom,
      ),
      whileInView: resolveTarget(
        opts.inView,
        variants,
        asVariantLabels(parentVariantCtx.inView?.()),
        custom,
      ),
      whileHover: resolveTarget(
        opts.hover,
        variants,
        asVariantLabels(parentVariantCtx.hover?.()),
        custom,
      ),
      whilePress: resolveTarget(
        opts.press,
        variants,
        asVariantLabels(parentVariantCtx.press?.()),
        custom,
      ),
      whileFocus: resolveTarget(
        opts.focus,
        variants,
        asVariantLabels(parentVariantCtx.focus?.()),
        custom,
      ),
      // whileDrag — resolved like any other gesture state's target. Drag's
      // visual state composes with drag's translation through the shared
      // VisualElement (Q5/C-lean).
      whileDrag: resolveTarget(opts.whileDrag, variants, undefined, custom),
      exit: resolveTarget(opts.exit, variants, asVariantLabels(parentVariantCtx.exit?.()), custom),
    }
  })

  // ---------- Per-key winners (priority resolution + per-key claim) ----------
  // Walks PRIORITY_HIGH_TO_LOW. A state is considered active if EITHER its
  // own flag is true OR the parent's VariantContext provides a label for it
  // (Q4 — gesture inheritance through context). The first active state that
  // defines a key claims it; lower-priority states are skipped for that key.
  //
  // Q5/C-lean exclusion: when `drag` is enabled, `x` and `y` are owned by
  // createDrag (it writes them to the VisualElement's MotionValues during
  // pointer phase). Filter them out of the winners map so motion's animate
  // (called from this effect) doesn't fight drag's writes. Other transform
  // keys (scale, rotate, etc.) still flow normally — they compose with
  // drag's translation through the shared VisualElement.
  const winners = createMemo<Record<string, WinnerEntry>>(() => {
    const targets = stateTargets()
    const dragEnabled = Boolean(getOpts().drag)
    const out: Record<string, WinnerEntry> = {}
    for (const stateName of PRIORITY_HIGH_TO_LOW) {
      if (!isStateActive(stateName, active, parentVariantCtx)) continue
      const target = targets[stateName]
      if (!target) continue
      for (const key in target) {
        // `transition` is animation config, not a style key — never a winner.
        if (key === "transition") continue
        // Higher-priority state already won this key.
        if (key in out) continue
        // x/y are drag-owned when drag is enabled (Q5/C-lean).
        if (dragEnabled && (key === "x" || key === "y")) continue
        out[key] = {
          value: (target as Record<string, unknown>)[key],
          transition: target.transition,
          stateName,
        }
      }
    }
    return out
  })

  // ---------- Diff-and-animate effect ----------
  // The single site that calls motion's animate(). Diffs winners against
  // lastApplied to compute changed keys (a) and removed keys (b). Removed keys
  // walk Q7's fallback chain: initial → motion default → null.
  let prevControls: AnimationPlaybackControls | null = null
  let lastApplied: Record<string, unknown> = {}
  let isFirstRun = true

  createEffect(() => {
    const next = winners()
    const opts = getOpts()

    // Q6 sub-3: `initial: false` skips the very first animate. Subsequent
    // signal-driven runs animate normally. We seed lastApplied so the next
    // iteration's diff treats the current winners as already-applied.
    // Note: even on this guard we still want to (re)subscribe to MVs in
    // `next` so subsequent MV.set() drives animate. Fall through to the
    // subscription loop below; just skip the actual animate dispatch.
    let skipAnimate = false
    if (isFirstRun && untrack(() => opts.initial) === false) {
      lastApplied = snapshotValues(next)
      skipAnimate = true
    }
    isFirstRun = false

    // Bail out completely only when there is nothing to do AND nothing has
    // been applied yet (no lastApplied to revert). The previous version of
    // this guard also bailed when `next` was empty even if lastApplied still
    // held values from a previous gesture — preventing the removed-key
    // fallback from reverting. The looser condition keeps the same early-out
    // for the initial idle case while letting deactivation reverts run.
    const bailOnNoTarget =
      !skipAnimate &&
      Object.keys(next).length === 0 &&
      Object.keys(lastApplied).length === 0 &&
      opts.animate === undefined &&
      parentVariantCtx.animate?.() === undefined
    if (bailOnNoTarget) return

    // Compute changes: (a) keys with new/changed values, (b) removed keys.
    const changes: Record<string, unknown> = {}
    let mergedPerTargetTransition: Transition | undefined

    if (!skipAnimate) {
      for (const key in next) {
        const entry = next[key]
        // `noUncheckedIndexedAccess` widens record reads to `T | undefined`,
        // but `for (key in obj)` only yields present keys — entry is real.
        if (!entry) continue
        if (lastApplied[key] !== entry.value) {
          changes[key] = entry.value
          // First non-undefined per-target transition wins. (If multiple winners
          // contribute conflicting transitions, the highest-priority one already
          // took precedence in the priority walk.)
          mergedPerTargetTransition ??= entry.transition
        }
      }
      for (const key in lastApplied) {
        if (key in next) continue
        // Removed-key fallback: own initial → motion default → null.
        const initialValue =
          initialTarget && key in (initialTarget as Record<string, unknown>)
            ? (initialTarget as Record<string, unknown>)[key]
            : undefined
        changes[key] = initialValue !== undefined ? initialValue : getMotionDefault(key)
      }
    }

    // Transition merge: MotionConfig default < user's transition < per-target
    // transition < reduced-motion override (Phase 1's mergeTransition).
    const reduced = shouldReduceMotion(motionConfig.reducedMotion(), systemReducedMotion())
    const transition = mergeTransition(
      motionConfig.transition(),
      opts.transition,
      mergedPerTargetTransition,
      reduced,
    )

    // Track which animate value triggered this — used by onAnimationComplete.
    // If `next` has any key from `animate` state, the effective value is opts.animate.
    // If only gesture states are active, the highest-priority active state's value drives.
    const driverState = highestActiveDriverState(next)
    const effectiveAnimateValue = animateValueForState(driverState, opts, parentVariantCtx)

    // Animate options builder — read at fire-time so reactive callback swaps
    // apply between calls (per Phase 1 semantics). Closed over by the
    // MV-on-change subscriptions below as well as the diff dispatch.
    const buildAnimateOptions = () => ({
      ...transition,
      onPlay: opts.onAnimationStart ? () => untrack(() => opts.onAnimationStart?.()) : undefined,
      onComplete: opts.onAnimationComplete
        ? () =>
            untrack(() => {
              if (effectiveAnimateValue != null) {
                opts.onAnimationComplete?.(effectiveAnimateValue)
              }
            })
        : undefined,
      onStop: opts.onAnimationCancel ? () => untrack(() => opts.onAnimationCancel?.()) : undefined,
      onUpdate: opts.onUpdate
        ? (latest: ResolvedValues) => untrack(() => opts.onUpdate?.(latest))
        : undefined,
    })

    if (!skipAnimate && Object.keys(changes).length > 0) {
      // Update lastApplied to the new winner snapshot (NOT including removed-
      // key fallback values — those become "applied" only after the animation
      // lands, but tracking that requires onUpdate plumbing. For diff purposes,
      // we consider them applied immediately; if the user re-activates a state
      // that brings the key back, the diff sees `lastApplied[key] = fallback`
      // vs `next[key] = newValue` and animates correctly).
      lastApplied = { ...lastApplied, ...changes }
      // Then drop keys that don't appear in `next` from lastApplied so future
      // re-removals don't compare against stale fallback values.
      for (const key in lastApplied) {
        if (!(key in next) && !(key in changes)) delete lastApplied[key]
      }

      // ---------- splitTarget: separate MotionValue refs from plain values ----------
      // Preserved from Phase 1: motion's vanilla animate(el, target) doesn't
      // subscribe to MotionValue refs in target values. We split and seed the
      // animate call with snapshots; per-MV subscription happens below.
      const { plain } = splitTarget(changes)

      // Cancel any in-flight animation before kicking off the next one.
      prevControls?.stop()
      // biome-ignore lint/suspicious/noExplicitAny: motion's animate has a complex overloaded shape we can't tighten generically; the runtime call is correct.
      prevControls = animate(el, plain as any, buildAnimateOptions())
    }

    // ---------- MotionValue-in-target subscriptions ----------
    // Walk `next` (the FULL winner set) rather than `changes` (the diff) and
    // subscribe a per-key animate callback to each MV's `change` event. This
    // loop runs on EVERY effect iteration that gets past the bailOnNoTarget
    // guard above, including iterations that produced no diff.
    //
    // Bug fix: previously this loop lived inside the "has changes" branch.
    // Sibling effects in createGestures (notably the inView wiring's
    // setActive call after IntersectionObserver's first emission) can
    // invalidate the winners memo without changing any actual value. On
    // those re-runs, the iteration-scoped `onCleanup` from the prior run
    // unsubscribed the MV listeners and we never reattached, dropping all
    // future MV.set() → animate plumbing. Walking `next` here keeps the
    // subscriptions in lockstep with the effect's lifetime.
    for (const key in next) {
      const entry = next[key]
      if (!entry) continue
      if (isMotionValue(entry.value)) {
        const mv = entry.value as MotionValue<unknown>
        onCleanup(
          mv.on("change", (v) => {
            // biome-ignore lint/suspicious/noExplicitAny: same as above
            animate(el, { [key]: v } as any, buildAnimateOptions())
          }),
        )
      }
    }
  })

  // Owner-disposal cleanup: stop any in-flight animation.
  onCleanup(() => prevControls?.stop())

  function setActive(state: GestureStateName, isActive: boolean): void {
    setActiveStore(state, isActive)
  }

  return { setActive }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Q4 — a state is considered active if EITHER its own flag is set OR the
 * parent's VariantContext carries a label for it (the parent's gesture is
 * active and propagating). The parent slots are themselves active-gated in
 * `useMotion`'s `myVariantCtx`, so a defined return value here means the
 * parent's gesture really is firing right now.
 *
 * `animate` and `exit` are special — their inheritance happens through the
 * normal label-resolution path in `resolveTarget`, not through the active
 * flag. We treat `animate` as always-active (matches motion's
 * createTypeState(true)). `exit` is driven by the Presence context; the
 * flag-based check is fine.
 */
function isStateActive(
  state: GestureStateName,
  active: ActiveStore,
  parent: VariantContextValue,
): boolean {
  if (active[state]) return true
  switch (state) {
    case "whileHover":
      return parent.hover?.() !== undefined
    case "whilePress":
      return parent.press?.() !== undefined
    case "whileFocus":
      return parent.focus?.() !== undefined
    case "whileInView":
      return parent.inView?.() !== undefined
    // Drag inheritance through context isn't wired in Phase 1's
    // VariantContextValue (no `drag` slot). Commit 6 will revisit if needed.
    case "whileDrag":
      return false
    case "animate":
    case "exit":
      return false
  }
}

/** Convert a winners map into the flat value snapshot used by `lastApplied`. */
function snapshotValues(winners: Record<string, WinnerEntry>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key in winners) {
    const entry = winners[key]
    if (entry) out[key] = entry.value
  }
  return out
}

/**
 * Phase 1's splitTarget: separate MotionValue refs in a target from plain
 * values. Motion-vanilla `animate(el, target)` doesn't subscribe to MV refs
 * passed in target — we handle that bridge ourselves.
 */
function splitTarget(target: Record<string, unknown>): {
  plain: Record<string, unknown>
  motionValues: Array<{ key: string; mv: MotionValue<unknown> }>
} {
  const plain: Record<string, unknown> = {}
  const motionValues: Array<{ key: string; mv: MotionValue<unknown> }> = []
  for (const key in target) {
    const value = target[key]
    if (value === undefined || value === null) {
      plain[key] = value
      continue
    }
    if (isMotionValue(value)) {
      motionValues.push({ key, mv: value as MotionValue<unknown> })
      plain[key] = (value as MotionValue<unknown>).get()
    } else if (typeof value === "function") {
      plain[key] = (value as () => unknown)()
    } else if (Array.isArray(value)) {
      plain[key] = value.map((v) => {
        if (isMotionValue(v)) return (v as MotionValue<unknown>).get()
        if (typeof v === "function") return (v as () => unknown)()
        return v
      })
    } else {
      plain[key] = value
    }
  }
  return { plain, motionValues }
}

/**
 * Return the highest-priority active state that contributed any key in the
 * current winners map. Used to identify the "driver" for onAnimationComplete
 * (which receives the AnimateValue that drove the animation).
 *
 * `animate` is the fallback when no gesture is contributing — matches Phase 1's
 * effectiveAnimateValue semantic.
 */
function highestActiveDriverState(winners: Record<string, WinnerEntry>): GestureStateName {
  // Walk PRIORITY_HIGH_TO_LOW and find the first state name that appears.
  for (const stateName of PRIORITY_HIGH_TO_LOW) {
    for (const key in winners) {
      const entry = winners[key]
      if (entry && entry.stateName === stateName) return stateName
    }
  }
  return "animate"
}

/**
 * Look up the AnimateValue (Target | string | string[]) that corresponds to a
 * given state — for onAnimationComplete's argument.
 */
function animateValueForState(
  state: GestureStateName,
  opts: MotionOptions,
  parentVariantCtx: VariantContextValue,
): AnimateValue | undefined {
  switch (state) {
    case "animate":
      return opts.animate ?? parentVariantCtx.animate?.()
    case "whileHover":
      return opts.hover ?? parentVariantCtx.hover?.()
    case "whilePress":
      return opts.press ?? parentVariantCtx.press?.()
    case "whileFocus":
      return opts.focus ?? parentVariantCtx.focus?.()
    case "whileInView":
      return opts.inView ?? parentVariantCtx.inView?.()
    case "exit":
      return opts.exit ?? parentVariantCtx.exit?.()
    case "whileDrag":
      return opts.whileDrag
  }
}
