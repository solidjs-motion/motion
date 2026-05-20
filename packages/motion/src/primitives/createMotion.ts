import { animate } from "motion"
import { createSignal, onCleanup, untrack } from "solid-js"
import { useMotionConfig } from "../motion-config"
import { usePresenceContext } from "../presence-context"
import { createReducedMotion, shouldReduceMotion } from "../reduced-motion"
import { targetToStyle } from "../style"
import type {
  AnimateValue,
  MotionElement,
  MotionOptions,
  Target,
  Transition,
  VariantContextValue,
  VariantLabels,
  Variants,
} from "../types"
import { effectiveLabels, resolveVariant, useVariantContext } from "../variants"
import { createDrag } from "./createDrag"
import { createGestures } from "./createGestures"
import { type ActiveStoreTuple, createGestureStateMachine } from "./gesture-state"
import { createValueRegistry } from "./value-registry"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect whether an animate-value is a variant name (string or string[]) vs.
 * an explicit target object. Returns the labels or undefined.
 */
export function asVariantLabels(value: AnimateValue | undefined): VariantLabels | undefined {
  if (value === undefined) return undefined
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value
  return undefined
}

/**
 * Resolve a per-state animate value into a {@link Target}. Implements the
 * Q4 sub-2 priority table:
 *
 * - explicit Target object → use as-is (parent context ignored)
 * - variant name → look up in own variants only (no cascade)
 * - undefined → fall back to parent context's variant name, then look up in
 *   own variants
 */
export function resolveTarget(
  ownValue: AnimateValue | undefined,
  ownVariants: Variants | undefined,
  parentLabel: VariantLabels | undefined,
  custom: unknown,
): Target | null {
  // Explicit Target object — variant lookup is skipped entirely.
  if (ownValue !== undefined && typeof ownValue !== "string" && !Array.isArray(ownValue)) {
    return ownValue as Target
  }

  const labels = effectiveLabels(ownValue, parentLabel)
  if (labels === undefined) return null
  // After the explicit-object check above, `labels` is VariantLabels or a
  // Target that came from `parentLabel` slot — but parent context only
  // propagates labels, never Targets, so it's safe to treat as labels here.
  return resolveVariant(labels as VariantLabels, ownVariants, custom)
}

/**
 * Merge transition specs in priority order: MotionConfig default <
 * user's `transition` < per-target `transition`. When reduced motion is
 * active, returns `{ duration: 0 }` and drops everything else (Q11 sub-4).
 */
export function mergeTransition(
  configDefault: Transition | undefined,
  ownTransition: Transition | undefined,
  perTargetTransition: Transition | undefined,
  reduced: boolean,
): Transition {
  if (reduced) return { duration: 0 } as Transition
  return {
    ...(configDefault ?? {}),
    ...(ownTransition ?? {}),
    ...(perTargetTransition ?? {}),
  } as Transition
}

/**
 * Apply a static target to an element's inline style before paint. Used on
 * mount when no SSR style was emitted. The ref callback fires before the
 * browser yields, so this avoids a frame of flicker.
 */
function applyStaticStyle(el: MotionElement, target: Target): void {
  const style = targetToStyle(target)
  for (const key in style) {
    const value = (style as Record<string, string | number | undefined>)[key]
    if (value === undefined) continue
    if (key.startsWith("--")) {
      el.style.setProperty(key, String(value))
    } else {
      // ElementCSSInlineStyle.style is indexable for camelCase property names.
      // Available on both HTMLElement and SVGElement (Phase 4 SVG support).
      ;(el.style as unknown as Record<string, string | number>)[key] = value
    }
  }
}

// ---------------------------------------------------------------------------
// createMotion — the imperative primitive that drives one element's motion
// state. useMotion wraps this; <motion.*> and motion() will wrap it too.
// ---------------------------------------------------------------------------

export type CreateMotionConfig = {
  /**
   * When true, `createMotion` skips applying the initial style — the server
   * already emitted it inline, and re-applying on hydration would shift the
   * paint. Detected via the `data-motion-hydrated` marker in useMotion.
   */
  initialAppliedBySSR?: boolean
  /**
   * Q4 — useMotion lifts the gesture-state active store one level up so its
   * `myVariantCtx` can read the same flags it propagates to descendants.
   * When omitted (standalone createMotion use), the state machine creates
   * its own internal store.
   */
  activeStore?: ActiveStoreTuple
  /**
   * Q4 follow-up — useMotion passes a shadowed parent context here so the
   * controlling-variants check is applied uniformly. When omitted, createMotion
   * falls back to `useVariantContext()` directly (the standalone path).
   */
  parentContext?: VariantContextValue
}

/**
 * The imperative primitive: bind an element to a reactive motion-options
 * source. Caller is responsible for keeping the element alive (refs in a
 * component, drag controls, etc.).
 *
 * Phase 1 scope: animate + initial + transition + lifecycle hooks +
 * reduced-motion override + presence registration. Phase 2 layers gesture
 * states (hover/press/focus/inView) and drag on top.
 */
export function createMotion(
  el: MotionElement,
  getOpts: () => MotionOptions,
  config?: CreateMotionConfig,
): void {
  // Q4 follow-up: useMotion passes a shadowed (controlling-aware) context;
  // standalone callers fall back to the live VariantContext.
  const parentVariantCtx: VariantContextValue = config?.parentContext ?? useVariantContext()
  const presence = usePresenceContext()
  const motionConfig = useMotionConfig()
  const systemReducedMotion = createReducedMotion()

  // ---------- Per-element value registry ----------
  // Stage 1 of the MV-in-style work: the registry exists for downstream
  // stages to wire into. Nothing reads or writes it yet — `dispose()` here
  // is a no-op until Stage 3 starts populating transient MVs for animate
  // targets. Kept here so the ownership story is clear from day one: the
  // registry's lifetime is bounded by `createMotion`'s owner, same as the
  // gesture state machine.
  const valueRegistry = createValueRegistry()
  onCleanup(() => valueRegistry.dispose())

  // Snapshot once at construction. Subsequent reactivity goes through
  // the createEffect below, so we don't subscribe in the body of this fn.
  const initialOpts = untrack(getOpts)

  // ---------- Resolve the initial target (used for BOTH static-style write AND
  //            the state machine's removed-key fallback chain, Q7) ----------
  // Priority chain (matches use-motion's computeInitialStyle):
  //   own.initial > parent.initial > own.animate > parent.animate
  //
  // We resolve this regardless of `initialAppliedBySSR` because the state
  // machine needs it even when SSR already wrote the inline style — the user's
  // explicit `initial` value is part of their intent and should anchor the
  // removed-key fallback regardless of who painted it.
  let capturedInitialTarget: Target | null = null
  if (initialOpts.initial !== false) {
    const inheritedInitial = parentVariantCtx.initial?.()
    const inheritedAnimate = parentVariantCtx.animate?.()
    const effective =
      initialOpts.initial !== undefined
        ? initialOpts.initial
        : inheritedInitial !== undefined
          ? inheritedInitial
          : initialOpts.animate !== undefined
            ? initialOpts.animate
            : inheritedAnimate
    if (effective !== undefined) {
      capturedInitialTarget = resolveTarget(
        effective,
        initialOpts.variants,
        undefined, // priority chain already consumed parent's labels
        initialOpts.custom ?? parentVariantCtx.custom?.(),
      )
    }
  }

  // ---------- Apply the initial style pre-paint, unless SSR already did it ----------
  // An enclosing `<Presence initial={false}>` ALSO suppresses the static
  // style application — the descendant should mount at the animate target,
  // not the initial. Done via the same path as the state machine's
  // `suppressFirstMount` flag below; consistent semantic across both.
  const suppressFirstMount = untrack(() => presence.initial?.()) === false
  if (!config?.initialAppliedBySSR && !suppressFirstMount && capturedInitialTarget) {
    applyStaticStyle(el, capturedInitialTarget)
  }

  // ---------- Presence-aware enter-readiness gate ----------
  // We detect "inside a real <Presence>" by the absence of `registerEnter` on
  // the no-op default context. When we ARE inside one, the element may be
  // off-DOM at the moment the state machine first iterates (the new child
  // during a mode="wait" swap is created before the old child's exit
  // settles, and even the initial child is briefly created off-DOM during
  // appear). Dispatching motion's `animate()` then would run the animation
  // on a disconnected element and silently fail commitStyles — the element
  // would paint at its `initial` target when it finally enters the DOM.
  //
  // Solution: start `enterReady = false` while in a Presence, register a
  // `runEnter` callable that flips it true, and let Presence call it from
  // its `onEnter` / `onChange.added` hook (when transition-group has
  // synchronously inserted the element via `setReturned`). Outside a
  // Presence we leave `enterReady` undefined; the state machine treats
  // absence as ready=true and the existing eager-first-iteration behavior
  // is unchanged.
  const inPresence = presence.registerEnter !== undefined
  const [enterReady, setEnterReady] = createSignal(!inPresence)
  if (inPresence && presence.registerEnter) {
    presence.registerEnter(el, () => setEnterReady(true))
    // Fallback: transition-group's onEnter / onChange.added only fires for
    // elements that are NEW to the source list. The initial children of a
    // `<Presence initial={false}>` (appear=false case) are already in the
    // signal at construction and never trigger an enter callback. We flip
    // readiness from a microtask if the element is connected by then —
    // Solid's synchronous render of `returned()` has run, and any element
    // that was meant to be on screen is in the DOM. For wait-mode swaps
    // where the new child is still off-DOM (the old one's exit is in
    // flight), the `isConnected` check fails and we leave readiness false;
    // Presence will fire beforeMount through onEnter when the exit settles.
    queueMicrotask(() => {
      if (el.isConnected) setEnterReady(true)
    })
  }

  // ---------- Gesture state machine (Q3b, ADR 0002) ----------
  // Constructed BEFORE presence registration so the registered `runExit`
  // callable can close over `setActive` + `onceExitComplete`. Owns target
  // resolution, priority winners, and the diff-and-animate loop. Returns
  // `setActive` which gesture wiring uses to toggle active flags, and
  // `onceExitComplete` which Presence awaits during unmount.
  // (For drag's typing constraint, see the createDrag call below.)
  const stateMachine = createGestureStateMachine({
    el,
    getOpts,
    parentVariantCtx,
    motionConfig,
    systemReducedMotion,
    initialTarget: capturedInitialTarget,
    externalActiveStore: config?.activeStore,
    suppressFirstMount,
    enterReady,
  })
  const { setActive, onceExitComplete } = stateMachine

  // ---------- Presence registration (Phase 3 — inverted shape) ----------
  // Child registers a `runExit` callable that dispatches the exit animate
  // DIRECTLY (bypassing the state-machine effect). Direct dispatch is
  // necessary because by the time Presence's `onExit` callback fires,
  // Solid has already disposed the surrounding owner — the state machine's
  // diff effect is gone. `runExit` therefore captures the exit-relevant
  // options at construction time and uses motion's `animate()` itself.
  //
  // We do NOT call `presence.unregister(el)` on owner cleanup — that would
  // race ahead of Presence's onExit. Instead, Presence/hook unregisters
  // after the exit settles. See ADR 0003 for the timing rationale.
  // Register a runExit for this element if EITHER:
  //   (a) it has its own `exit` prop, OR
  //   (b) an ancestor's exit label cascades down via VariantContext AND this
  //       element has a `variants` map that could resolve against it.
  //
  // (b) is the motion-react canonical orchestration pattern: a parent shell
  // declares `exit: "closed"` (a label), wraps children in `m.Provider`, and
  // children are passive consumers — they have ONLY a `variants` map keyed
  // by `"closed"` (and other labels). Without (b), the children would never
  // register a runExit and Presence's subtree-walk wouldn't find them; the
  // cascade would work on enter but vanish on exit.
  //
  // The check uses parentVariantCtx.exit?.() which (per use-motion.tsx's
  // `myVariantCtx.exit`) returns the parent's exit prop unconditionally —
  // not gated on the parent's active.exit flag — so this snapshot at
  // construction sees the static cascaded label, not a transient runtime
  // value.
  const inheritedExitLabel = untrack(() => parentVariantCtx.exit?.())
  const hasOwnExit = initialOpts.exit !== undefined
  const hasCascadedExit =
    inheritedExitLabel !== undefined && initialOpts.variants !== undefined

  if (hasOwnExit || hasCascadedExit) {
    const runExit = async (): Promise<void> => {
      // Re-read opts at exit time. The previous design snapshotted them at
      // construction, which broke any pattern where `exit` is reactive — a
      // swipe-card whose exit direction depends on which way the user just
      // flicked, for example, would always exit using the PREVIOUS card's
      // direction (the value that was live when THIS card mounted). We
      // untrack the read because we don't want to subscribe anything that
      // would still be alive after the surrounding owner has been disposed
      // by Solid's `<Show>` / `<For>` swap. The props proxy itself survives
      // disposal — it's just a JS object that the runExit closure keeps
      // referenced — so reading `props.X` here returns the latest value
      // the parent passed in.
      const opts = untrack(getOpts)
      // `resolveTarget` walks own.exit, then the inherited cascade. When
      // neither produces a target there's nothing to animate — return
      // without setActive so we don't hang on the (potentially dead)
      // state machine's onceExitComplete.
      const exitTarget = resolveTarget(
        opts.exit,
        opts.variants,
        asVariantLabels(untrack(() => parentVariantCtx.exit?.())),
        opts.custom ?? parentVariantCtx.custom?.(),
      )
      if (!exitTarget) {
        // Resolved to null (e.g., the user passed a label that doesn't
        // exist in variants). Cooperate with the state machine for cases
        // where the user expects an "exit" gesture without specific keys.
        setActive("exit", true)
        await onceExitComplete()
        return
      }

      // Merge transition: MotionConfig default < user.transition <
      // exit-target.transition < reduced-motion override.
      const reduced = shouldReduceMotion(motionConfig.reducedMotion(), systemReducedMotion())
      const transition = mergeTransition(
        motionConfig.transition(),
        opts.transition,
        exitTarget.transition,
        reduced,
      )

      // Strip `transition` from the target before passing to animate.
      const animTarget: Record<string, unknown> = {}
      for (const k in exitTarget) {
        if (k !== "transition") {
          animTarget[k] = (exitTarget as Record<string, unknown>)[k]
        }
      }

      // biome-ignore lint/suspicious/noExplicitAny: motion's animate has a complex overloaded shape we can't tighten generically; the runtime call is correct.
      const controls = animate(el, animTarget as any, transition as any)
      // AnimationPlaybackControls is thenable at runtime (motion 12.x).
      // The public type doesn't expose `.then` — narrow via PromiseLike.
      await (controls as unknown as PromiseLike<unknown>)
    }

    presence.register(el, runExit)
    // No `onCleanup(() => presence.unregister(el))` — that would fire
    // synchronously when Solid disposes the child's owner, BEFORE
    // transition-group's `onExit` callback runs. Presence/hook calls
    // `unregister` itself after the exit settles. For the no-op default
    // context (no enclosing Presence), `register` is a silent drop —
    // nothing to clean up.
  }

  // ---------- Pointer-event gestures (hover, press, focus, inView) ----------
  // Listeners attach unconditionally on mount; the state machine no-ops when
  // an active state has no target.
  createGestures(el, getOpts, setActive)

  // ---------- Drag + pan (Q5/C-lean + Q11/D3) ----------
  // createDrag layers on createPan for the pointer session and writes to the
  // element's VisualElement x/y MotionValues during drag. Drag is HTML-only
  // for v0.1 — motion-dom's HTMLVisualElement is HTML-specific. Users who
  // wire `drag` onto an SVG element get a no-op at construction; we could
  // surface a dev warning here later if needed.
  if (el instanceof HTMLElement) {
    createDrag(el, getOpts, setActive)
  }
}

// Re-export for useMotion to consume the same helpers without circular deps.
export { applyStaticStyle }
