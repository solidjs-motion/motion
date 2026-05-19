import { onCleanup, untrack } from "solid-js"
import { useMotionConfig } from "../motion-config"
import { usePresenceContext } from "../presence-context"
import { createReducedMotion } from "../reduced-motion"
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
  if (!config?.initialAppliedBySSR && capturedInitialTarget) {
    applyStaticStyle(el, capturedInitialTarget)
  }

  // ---------- Presence registration ----------
  if (initialOpts.exit !== undefined) {
    presence.register(el, initialOpts.exit, initialOpts.transition)
    onCleanup(() => presence.unregister(el))
  }

  // ---------- Gesture state machine (Q3b, ADR 0002) ----------
  // Owns target resolution, priority winners, and the diff-and-animate loop.
  // Returns `setActive` which gesture wiring uses to toggle active flags.
  // When useMotion supplies an external active store (Q4), the state machine
  // reads/writes that one — letting myVariantCtx propagate the same flags.
  const { setActive } = createGestureStateMachine({
    el,
    getOpts,
    parentVariantCtx,
    motionConfig,
    systemReducedMotion,
    initialTarget: capturedInitialTarget,
    externalActiveStore: config?.activeStore,
  })

  // ---------- Pointer-event gestures (hover, press, focus, inView) ----------
  // Listeners attach unconditionally on mount; the state machine no-ops when
  // an active state has no target.
  createGestures(el, getOpts, setActive)

  // ---------- Drag + pan (Q5/C-lean + Q11/D3) ----------
  // createDrag layers on createPan for the pointer session and writes to the
  // element's VisualElement x/y MotionValues during drag. Always attached;
  // the `isDragEnabled()` check inside createDrag means listeners do nothing
  // when `opts.drag` is falsy — toggling drag on/off doesn't churn listeners.
  //
  // Drag is HTML-only for v0.1 — motion-dom's HTMLVisualElement is HTML-
  // specific. The `instanceof HTMLElement` narrowing means a user who wires
  // `drag` onto an SVG element gets a no-op at construction. We could surface
  // a dev warning here later if needed.
  if (el instanceof HTMLElement) {
    createDrag(el, getOpts, setActive)
  }
}

// Re-export for useMotion to consume the same helpers without circular deps.
export { applyStaticStyle }
