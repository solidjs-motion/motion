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
  /**
   * Phase 3 — when an enclosing `<Presence initial={false}>` is active, this
   * is passed through to suppress the first-mount animate (mirrors the
   * existing `initial: false` user-opt-out, but driven from above by
   * Presence instead of by the user's own options).
   */
  suppressFirstMount?: boolean
  /**
   * Phase 3 — readiness gate for the first-mount animate when this motion
   * element is wrapped in a real `<Presence>`. The state machine reads this
   * on each iteration; when it's `false` AND we haven't run yet, the diff
   * effect short-circuits (no animate dispatch, no MV subscriptions sealed).
   * Presence flips it to `true` from its `onEnter` / `onChange.added`
   * callback, at which point the effect re-runs and treats THAT iteration
   * as the first.
   *
   * Outside a Presence (no-op default context), createMotion leaves this
   * `undefined` — the state machine treats absence as `ready=true` and the
   * existing eager-first-iteration behavior is unchanged.
   *
   * Rationale: real `motion.animate()` is a Web Animations API call that
   * runs even on a disconnected element, but its terminal `commitStyles`
   * silently no-ops when the element is off-DOM. For a `mode: "wait"` swap
   * the new child is created BEFORE the old child's exit completes, so
   * dispatching the first animate eagerly would let it complete in the
   * detached state and the element would paint at its `initial` target
   * when it finally enters the DOM. Deferring until `onEnter` (when
   * transition-group has synchronously inserted the element via
   * `setReturned`) closes that gap.
   */
  enterReady?: Accessor<boolean>
  /**
   * MV-in-style Stage 3 bridge. When provided, the diff effect calls this
   * per animate-target key. A returned `MotionValue` routes the animation
   * through that MV (`animate(mv, value, opts)`) — its change-subscription
   * (in createMotion) composes `el.style` from the registry. `undefined`
   * routes the key down the existing `animate(el, target, opts)` WAA path.
   *
   * createMotion only activates this when at least one external MV is
   * registered (i.e., the user supplied `style: { scale: mv }`-shaped
   * options). Inactive in the common case → 293 baseline tests stay on
   * the original code path, their animateSpy assertions unaffected.
   */
  getValueForAnimate?: (key: string, fallback: unknown) => MotionValue<unknown> | undefined
}

export type GestureStateMachine = {
  /** Imperatively toggle a gesture state. Triggers re-resolution + animate(). */
  setActive: SetActive
  /**
   * The reactive active-flags store. Exposed so peer per-element machinery
   * (in particular `createLayoutController`, for Reorder's drag-suppressed
   * FLIP gate) can subscribe to specific flags like `whileDrag` without
   * needing to route through the state machine's diff effect.
   *
   * Read-only by convention — only `setActive` should mutate. The
   * underlying store is the same instance whether internal to this
   * machine or provided via `externalActiveStore`.
   */
  active: ActiveStore
  /**
   * Resolves when the next animate dispatched while `exit` is the highest-
   * priority active driver state completes. If no exit animation is in
   * flight AND no exit target is defined, resolves immediately.
   *
   * Used by `createMotion`'s presence registration: the registered
   * `runExit` callable does `setActive("exit", true)` then awaits this.
   * When the exit animation settles, `<Presence>` (or the hook) gets a
   * resolved Promise and proceeds with DOM removal.
   *
   * Multiple concurrent waiters are supported — they all resolve from the
   * same animation's completion.
   */
  onceExitComplete: () => Promise<void>
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
    suppressFirstMount,
    enterReady,
    getValueForAnimate,
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
      // VisualElement (Q5/C-lean). Inherits the parent's `drag` label so
      // descendants without their own `whileDrag` prop pick up the
      // ancestor's drag variant while the ancestor is being dragged.
      whileDrag: resolveTarget(
        opts.whileDrag,
        variants,
        asVariantLabels(parentVariantCtx.drag?.()),
        custom,
      ),
      exit: resolveTarget(opts.exit, variants, asVariantLabels(parentVariantCtx.exit?.()), custom),
    }
  })

  // ---------- Per-key winners (priority resolution + per-key claim) ----------
  // Walks PRIORITY_HIGH_TO_LOW. A state is considered active if EITHER its
  // own flag is true OR the parent's VariantContext provides a label for it
  // (Q4 — gesture inheritance through context). The first active state that
  // defines a key claims it; lower-priority states are skipped for that key.
  //
  // Q5/C-lean exclusion: while drag is ACTIVE (pointer engaged), `x` and `y`
  // are owned by
  // createDrag (it writes them to the VisualElement's MotionValues during
  // pointer phase). Filter them out of the winners map so motion's animate
  // (called from this effect) doesn't fight drag's writes. Other transform
  // keys (scale, rotate, etc.) still flow normally — they compose with
  // drag's translation through the shared VisualElement.
  //
  // EXCEPTION: when `exit` is active, exit's x/y MUST override drag's claim.
  // Otherwise an element being dragged at the moment of unmount would
  // exit-animate without translation (drag would silently win every frame),
  // which contradicts the priority chain's stated semantic (exit is highest).
  // Drag's pointer listeners will release anyway when the element unmounts;
  // exit's translation reaches DOM until that happens.
  const winners = createMemo<Record<string, WinnerEntry>>(() => {
    const targets = stateTargets()
    // Drag claims x/y only while the user is ACTIVELY dragging (pointer
    // engaged → `active.whileDrag === true`). When drag is merely
    // configured-but-idle, initial/animate/exit and other states get
    // normal access to x/y — matching motion-react. Reading from `active`
    // tracks the store; the winners memo re-runs when whileDrag flips.
    const dragActive = active.whileDrag
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
        // x/y are drag-owned during active drag — unless exit is also
        // active, in which case exit's translation wins.
        if (!active.exit && dragActive && (key === "x" || key === "y")) continue
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
  // lastApplied to compute changed keys (a) and removed keys (b). Removed
  // keys walk the revert chain: initial → motion default → originals → null.
  let prevControls: AnimationPlaybackControls | null = null
  let lastApplied: Record<string, unknown> = {}
  let isFirstRun = true

  // ---------- Pre-gesture computed-style snapshots (originals) ----------
  // For NON-transform CSS keys (anything not in TRANSFORM_DEFAULTS — e.g.,
  // box-shadow, background-color, border-color), the removed-key fallback
  // has no canonical default value to revert to. Motion's `animate(el,
  // { key: null })` is meant to read computed style at animation start, but
  // by revert-dispatch time the element's computed style already reflects
  // the gesture target — so the "revert" lands on the current value and
  // the property stays visibly stuck.
  //
  // captureOriginals() runs ONCE on the first effect iteration (after the
  // Presence readiness gate, before any animate dispatches). At that
  // moment the element shows ONLY `initialTarget` + whatever CSS/inline
  // style was already on it — no gesture has fired. That's the true
  // baseline. We snapshot it via getComputedStyle and serve it from
  // getRevertValue() when motion's default returns null.
  const originals: Record<string, unknown> = {}
  function captureOriginals(): void {
    const targets = untrack(() => stateTargets())
    let cs: CSSStyleDeclaration | undefined
    for (const stateName in targets) {
      const target = targets[stateName as GestureStateName]
      if (!target) continue
      for (const key in target) {
        if (key === "transition") continue
        // Skip keys with a canonical motion default (x/y/scale/opacity/...);
        // computed-style for transforms gives `"matrix(...)"` not `1`.
        if (getMotionDefault(key) !== null) continue
        if (key in originals) continue
        cs ??= window.getComputedStyle(el as unknown as Element)
        const raw = cs.getPropertyValue(toKebabCase(key))
        originals[key] = normalizeOriginal(key, raw)
      }
    }
  }

  /**
   * Walk the revert chain for a key whose owning state has deactivated:
   *   1. own `initial` target — explicit user intent wins
   *   2. motion default — canonical baseline for transforms/opacity
   *   3. captured original — pre-gesture computed style (non-transform keys)
   *   4. `null` — motion reads from computed style at animation start
   *      (in practice the element is already at the gesture value here,
   *      so this is the "stuck" terminal — the originals branch above is
   *      what makes non-transform reverts work without the user adding
   *      every gesture key to `animate`)
   */
  function getRevertValue(key: string): unknown {
    if (initialTarget && key in (initialTarget as Record<string, unknown>)) {
      return (initialTarget as Record<string, unknown>)[key]
    }
    const motionDefault = getMotionDefault(key)
    if (motionDefault !== null) return motionDefault
    if (key in originals) return originals[key]
    return null
  }

  // ---------- onceExitComplete plumbing (Phase 3 — Presence integration) ----------
  // Resolvers queued by `onceExitComplete()` waiters. Drain happens when an
  // exit-driven animate dispatched from this effect resolves. Multiple waiters
  // for the same exit batch all resolve from one drain.
  let pendingExitResolvers: Array<() => void> = []
  function drainPendingExitResolvers(): void {
    const resolvers = pendingExitResolvers
    pendingExitResolvers = []
    for (const r of resolvers) r()
  }

  createEffect(() => {
    const next = winners()
    const opts = getOpts()

    // Presence-aware readiness gate: when the surrounding `<Presence>` is
    // still holding this element off-DOM (the new child during a mode="wait"
    // swap, or the initial child before appear's enterTransition runs),
    // we MUST NOT dispatch the first animate. Web Animations API will run
    // it to completion off-DOM, then silently drop the final commitStyles —
    // the element would paint at its `initial` target when it eventually
    // enters the DOM. Skip the entire iteration (winners() above subscribed
    // us to future changes); when Presence flips enterReady this effect
    // re-runs and the iteration below treats THAT pass as the first.
    if (isFirstRun && enterReady && !enterReady()) {
      return
    }

    // Originals capture — one-shot, after the Presence gate so the element
    // is on-DOM, before any animate dispatch so computed style reflects
    // strictly the initialTarget + element CSS (no gesture has fired yet).
    if (isFirstRun) {
      captureOriginals()
    }

    // First-mount guard: either the user opted out via `initial: false` OR
    // an enclosing `<Presence initial={false}>` propagated suppression via
    // `suppressFirstMount`. Either path seeds lastApplied so the next
    // iteration treats current winners as already-applied. We fall through
    // to the MV subscription loop so subsequent MV.set() drives animate.
    let skipAnimate = false
    if (isFirstRun && (untrack(() => opts.initial) === false || suppressFirstMount)) {
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
        // x/y aren't "removed" when drag is active — drag is CLAIMING them.
        // Falling back to initial here would dispatch animate(el, {x:-W})
        // on pointerdown and snap the element back to its initial state
        // before the user's first move could reach the DOM.
        if (active.whileDrag && (key === "x" || key === "y")) continue
        const revertValue = getRevertValue(key)
        // Equality guard — if the previously-applied value already matches
        // the revert target, the dispatch would be a zero-effect animate()
        // that still calls prevControls.stop() and cancels any in-flight
        // tween. Common case: a gesture whose target happens to equal the
        // motion default or the captured original. The prune step below
        // still drops the key from lastApplied so we don't reconsider it.
        if (lastApplied[key] === revertValue) continue
        changes[key] = revertValue
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

    // Prune removed keys from lastApplied REGARDLESS of whether we
    // dispatch below. The removed-key fallback is a one-shot revert:
    // - If we dispatched it (changes had the key), we're done — drop it.
    // - If the equality guard above skipped it (revert value already
    //   matched), lastApplied is already at the right value — drop it
    //   too so we don't reconsider on every subsequent effect run.
    // Keeping stale entries used to allow the next iteration to re-fire
    // the fallback and spuriously cancel any in-flight animation via
    // prevControls.stop().
    for (const key in lastApplied) {
      if (!(key in next)) delete lastApplied[key]
    }

    if (!skipAnimate && Object.keys(changes).length > 0) {
      // Update lastApplied to the new winner snapshot (NOT including removed-
      // key fallback values — those become "applied" only after the animation
      // lands, but tracking that requires onUpdate plumbing. For diff purposes,
      // we consider them applied immediately; if the user re-activates a state
      // that brings the key back, the diff sees `lastApplied[key] = fallback`
      // vs `next[key] = newValue` and animates correctly).
      lastApplied = { ...lastApplied, ...changes }

      // ---------- splitTarget: separate MotionValue refs from plain values ----------
      // Preserved from Phase 1: motion's vanilla animate(el, target) doesn't
      // subscribe to MotionValue refs in target values. We split and seed the
      // animate call with snapshots; per-MV subscription happens below.
      const { plain } = splitTarget(changes)

      // ---------- Stage 3 bridge: split `plain` by routing destination ----------
      // When createMotion's `getValueForAnimate` returns an MV for a key, the
      // tween runs against that MV (transient or external) and the registry's
      // writer composes el.style.transform. When it returns undefined (the
      // common case — no style MVs), the key falls through to the existing
      // `animate(el, target, opts)` WAA path. With NO routed keys, we make a
      // single WAA call exactly like before, preserving the call shape that
      // baseline tests assert against.
      const routed: Array<{ mv: MotionValue<unknown>; value: unknown }> = []
      const waaPlain: Record<string, unknown> = {}
      for (const key in plain) {
        const value = plain[key]
        const fallback = getRevertValue(key)
        const routedMV = getValueForAnimate?.(key, fallback)
        if (routedMV) {
          routed.push({ mv: routedMV, value })
        } else {
          waaPlain[key] = value
        }
      }

      // Cancel any in-flight animation before kicking off the next one.
      prevControls?.stop()
      const animOpts = buildAnimateOptions()
      if (routed.length === 0) {
        // Pure WAA path — identical to the pre-Stage-3 behavior.
        // biome-ignore lint/suspicious/noExplicitAny: motion's animate has a complex overloaded shape we can't tighten generically; the runtime call is correct.
        prevControls = animate(el, waaPlain as any, animOpts)
      } else {
        // Bridge path — one tween per routed MV plus (optionally) a single
        // WAA call for non-routed keys. `aggregateControls` combines them
        // into a thenable that .stop()s each and resolves when all settle,
        // so the exit-drain logic below works uniformly across both shapes.
        const controls: AnimationPlaybackControls[] = []
        for (const { mv, value } of routed) {
          // biome-ignore lint/suspicious/noExplicitAny: same as above
          controls.push(animate(mv as any, value as any, animOpts as any))
        }
        if (Object.keys(waaPlain).length > 0) {
          // biome-ignore lint/suspicious/noExplicitAny: same as above
          controls.push(animate(el, waaPlain as any, animOpts))
        }
        prevControls = aggregateControls(controls)
      }

      // Drain `onceExitComplete()` waiters when this dispatch is driven by
      // the exit state — i.e., Presence is awaiting the unmount animation.
      // motion's AnimationPlaybackControls is thenable at runtime (motion
      // returns a thenable handle) but the public type doesn't surface
      // `.then` — narrow via PromiseLike. The promise settles on natural
      // completion OR cancellation (`.stop()` from a subsequent effect
      // run). Both should drain — from the caller's perspective the exit
      // animation is "done" either way. The freshness check ensures a stale
      // dispatch doesn't drain a newer animation's waiters.
      if (driverState === "exit") {
        const dispatched = prevControls
        const thenable = dispatched as unknown as PromiseLike<unknown>
        thenable.then(() => {
          if (prevControls === dispatched) drainPendingExitResolvers()
        })
      }
    } else if (driverState === "exit") {
      // Exit is the driver but no animate ran (target absent or no key diff).
      // Drain immediately so any awaiting `runExit` callers don't hang.
      drainPendingExitResolvers()
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
        const targetMV = entry.value as MotionValue<unknown>
        onCleanup(
          targetMV.on("change", (v) => {
            // Stage 3: route through the registry the same way the main
            // dispatch does, so a style MV the user also wrote into
            // `animate` doesn't bypass the writer's transform composition.
            const fallback = getRevertValue(key)
            const routedMV = getValueForAnimate?.(key, fallback)
            if (routedMV && routedMV !== targetMV) {
              // biome-ignore lint/suspicious/noExplicitAny: motion's animate overload soup; runtime correct
              animate(routedMV as any, v as any, buildAnimateOptions() as any)
            } else {
              // biome-ignore lint/suspicious/noExplicitAny: same as above
              animate(el, { [key]: v } as any, buildAnimateOptions())
            }
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

  /**
   * Phase 3 — Presence integration. Returns a Promise that resolves when the
   * NEXT exit-driven animate dispatched by the diff effect completes, OR
   * immediately if no exit target is configured (nothing to wait for).
   *
   * The typical caller is `createMotion`'s presence-registered `runExit`:
   * it flips `setActive("exit", true)` then awaits this. The diff effect
   * runs in the next microtask, dispatches the exit animation, and on its
   * completion drains the pending resolvers.
   *
   * Multiple concurrent waiters are supported — they all resolve from the
   * same animation's completion.
   *
   * Edge case: if the user reactively removes `opts.exit` AFTER this call
   * but before the effect runs, the resolver will still be drained the
   * next time exit drives a dispatch (or by the "no-animate but exit-
   * driven" branch in the effect).
   */
  function onceExitComplete(): Promise<void> {
    const exitTarget = untrack(() => stateTargets().exit)
    if (exitTarget === null) return Promise.resolve()
    return new Promise<void>((resolve) => {
      pendingExitResolvers.push(resolve)
    })
  }

  return { setActive, active, onceExitComplete }
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
    case "whileDrag":
      return parent.drag?.() !== undefined
    case "animate":
    case "exit":
      return false
  }
}

/** "boxShadow" → "box-shadow"; "box-shadow" → "box-shadow". */
function toKebabCase(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

/**
 * Normalize a captured computed-style value into something WAA can interpolate
 * from. Only intervenes for shadow keys where computed style returns the
 * keyword `"none"` (real browsers) or `""` (jsdom + no inline shadow) — WAA
 * can't smoothly interpolate either to/from a concrete shadow value, so both
 * become a transparent zero-shadow with matching component shape. Other
 * values pass through unchanged — if the element already has an explicit
 * shadow via CSS or inline style, that's the right revert target.
 */
function normalizeOriginal(key: string, value: string): string {
  if (
    (key === "box-shadow" ||
      key === "text-shadow" ||
      key === "boxShadow" ||
      key === "textShadow") &&
    (value === "none" || value === "")
  ) {
    return "0px 0px 0px rgba(0,0,0,0)"
  }
  return value
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
      return opts.whileDrag ?? parentVariantCtx.drag?.()
  }
}

/**
 * Combine N AnimationPlaybackControls into a single Thenable+stoppable handle.
 *
 * Used by the Stage 3 bridge when an animate dispatch fans out across per-MV
 * `animate(mv, value, opts)` calls (one per routed key) plus an optional
 * single `animate(el, target, opts)` for keys still on the WAA path. The
 * gesture state machine treats `prevControls` as one handle: subsequent diff
 * runs call `.stop()` on it to cancel the in-flight animation, and the exit
 * drain awaits `.then(...)` to settle Presence's `onceExitComplete()` waiters.
 * Aggregating lets both code paths stay uniform whether bridging fired one
 * underlying motion call or six.
 *
 * The other AnimationPlaybackControls methods (pause/play/cancel/complete)
 * fan out unchanged. `time`/`speed`/`duration` aren't aggregated — they're
 * read-rare in our codebase and a meaningful aggregate isn't well-defined
 * across heterogeneous animations.
 */
function aggregateControls(
  controls: readonly AnimationPlaybackControls[],
): AnimationPlaybackControls {
  // Cache the settle promise so multiple `.then` consumers don't each spawn a
  // fresh Promise.all over the same controls. motion's AnimationPlaybackControls
  // is thenable at runtime (the public type omits `.then`, hence the casts).
  let settled: Promise<unknown[]> | null = null
  const settle = (): Promise<unknown[]> => {
    if (!settled) {
      settled = Promise.all(controls.map((c) => c as unknown as PromiseLike<unknown>))
    }
    return settled
  }
  const forAll = (fn: (c: AnimationPlaybackControls) => void): void => {
    for (const c of controls) fn(c)
  }
  const handle: Record<string, unknown> = {
    stop: () => {
      forAll((c) => c.stop())
    },
    pause: () => {
      forAll((c) => c.pause())
    },
    play: () => {
      forAll((c) => c.play())
    },
    cancel: () => {
      forAll((c) => c.cancel())
    },
    complete: () => {
      forAll((c) => c.complete())
    },
    speed: 1,
    time: 0,
    duration: controls.reduce(
      (acc, c) => Math.max(acc, (c as { duration?: number }).duration ?? 0),
      0,
    ),
    // biome-ignore lint/suspicious/noThenProperty: structurally mirroring motion's AnimationPlaybackControls, which is intentionally thenable.
    then: (onFulfilled?: unknown, onRejected?: unknown) =>
      settle().then(onFulfilled as never, onRejected as never),
  }
  return handle as unknown as AnimationPlaybackControls
}
