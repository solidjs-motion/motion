import { type AnimationPlaybackControls, animate, isMotionValue, type MotionValue } from "motion"
import { createEffect, onCleanup, untrack } from "solid-js"
import { useMotionConfig } from "../motion-config"
import { usePresenceContext } from "../presence-context"
import { createReducedMotion, shouldReduceMotion } from "../reduced-motion"
import { targetToStyle } from "../style"
import type {
  AnimateValue,
  MotionOptions,
  ResolvedValues,
  Target,
  Transition,
  VariantContextValue,
  VariantLabels,
  Variants,
} from "../types"
import { effectiveLabels, resolveVariant, useVariantContext } from "../variants"

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
 * Result of splitting a target into engine-ready plain values vs. MotionValue
 * refs that need to drive per-change re-animation. Solid Accessors are
 * snapshotted by calling them (the surrounding createEffect tracks them);
 * MotionValues take the dedicated subscription path.
 *
 * The `transition` key is stripped — it's animation config consumed by
 * mergeTransition, not a style property.
 */
type SplitTarget = {
  /** Plain values ready to pass into motion's `animate(el, target, opts)`. */
  plain: Record<string, unknown>
  /** MotionValue refs found at the top level; each gets a per-change handler. */
  motionValues: Array<{ key: string; mv: MotionValue<unknown> }>
}

function splitTarget(target: Target): SplitTarget {
  const plain: Record<string, unknown> = {}
  const motionValues: Array<{ key: string; mv: MotionValue<unknown> }> = []
  for (const key in target) {
    if (key === "transition") continue
    const value = (target as Record<string, unknown>)[key]
    if (value === undefined || value === null) continue
    if (isMotionValue(value)) {
      // Capture for change-subscription; seed the initial animate call with
      // the current MotionValue snapshot so the first frame is correct.
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
 * Apply a static target to an element's inline style before paint. Used on
 * mount when no SSR style was emitted. The ref callback fires before the
 * browser yields, so this avoids a frame of flicker.
 */
function applyStaticStyle(el: HTMLElement, target: Target): void {
  const style = targetToStyle(target)
  for (const key in style) {
    const value = (style as Record<string, string | number | undefined>)[key]
    if (value === undefined) continue
    if (key.startsWith("--")) {
      el.style.setProperty(key, String(value))
    } else {
      // HTMLElement.style is indexable for camelCase property names.
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
  el: HTMLElement,
  getOpts: () => MotionOptions,
  config?: CreateMotionConfig,
): void {
  const parentVariantCtx: VariantContextValue = useVariantContext()
  const presence = usePresenceContext()
  const motionConfig = useMotionConfig()
  const systemReducedMotion = createReducedMotion()

  // Snapshot once at construction. Subsequent reactivity goes through
  // the createEffect below, so we don't subscribe in the body of this fn.
  const initialOpts = untrack(getOpts)

  // ---------- Initial style: applied in this ref-callback pre-paint ----------
  // Priority chain (matches use-motion's computeInitialStyle):
  //   own.initial > parent.initial > own.animate > parent.animate
  if (!config?.initialAppliedBySSR && initialOpts.initial !== false) {
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
    const initialTarget =
      effective !== undefined
        ? resolveTarget(
            effective,
            initialOpts.variants,
            undefined, // priority chain already consumed parent's labels
            initialOpts.custom ?? parentVariantCtx.custom?.(),
          )
        : null
    if (initialTarget) {
      applyStaticStyle(el, initialTarget)
    }
  }

  // ---------- Presence registration ----------
  if (initialOpts.exit !== undefined) {
    presence.register(el, initialOpts.exit, initialOpts.transition)
    onCleanup(() => presence.unregister(el))
  }

  // ---------- Animate effect ----------
  let prevControls: AnimationPlaybackControls | null = null
  let isFirstRun = true

  createEffect(() => {
    const opts = getOpts()
    const animateValue = opts.animate
    if (animateValue === undefined && parentVariantCtx.animate?.() === undefined) return

    // First-run guard for initial:false (Q6 sub-3). The very first effect
    // tick after construction is skipped when initial:false; subsequent
    // signal-driven runs animate normally.
    if (isFirstRun && opts.initial === false) {
      isFirstRun = false
      return
    }
    const wasFirstRun = isFirstRun
    isFirstRun = false

    const target = resolveTarget(
      animateValue,
      opts.variants,
      asVariantLabels(parentVariantCtx.animate?.()),
      opts.custom ?? parentVariantCtx.custom?.(),
    )
    if (!target) return

    const reduced = shouldReduceMotion(motionConfig.reducedMotion(), systemReducedMotion())
    const transition = mergeTransition(
      motionConfig.transition(),
      opts.transition,
      target.transition,
      reduced,
    )

    // Cancel any in-flight animation before kicking off the next one.
    prevControls?.stop()

    const { plain, motionValues } = splitTarget(target)
    const effectiveAnimateValue = animateValue ?? parentVariantCtx.animate?.()

    const buildAnimateOptions = () => ({
      ...transition,
      onPlay: opts.onAnimationStart ? () => untrack(() => opts.onAnimationStart?.()) : undefined,
      onComplete: opts.onAnimationComplete
        ? () =>
            untrack(() => {
              if (effectiveAnimateValue !== undefined) {
                opts.onAnimationComplete?.(effectiveAnimateValue)
              }
            })
        : undefined,
      onStop: opts.onAnimationCancel ? () => untrack(() => opts.onAnimationCancel?.()) : undefined,
      onUpdate: opts.onUpdate
        ? (latest: ResolvedValues) => untrack(() => opts.onUpdate?.(latest))
        : undefined,
    })

    // biome-ignore lint/suspicious/noExplicitAny: motion's animate has a complex overloaded shape we can't tighten generically; the runtime call is correct.
    prevControls = animate(el, plain as any, buildAnimateOptions())

    // For every MotionValue captured at the top level of `target`, subscribe
    // to changes and re-tween that single property to the new value. This is
    // what makes `animate: { width: mv }` follow imperative `mv.set(...)`
    // updates — the surrounding createEffect only tracks Solid signals, so MV
    // changes need their own bridge.
    for (const { key, mv } of motionValues) {
      onCleanup(
        mv.on("change", (v) => {
          // biome-ignore lint/suspicious/noExplicitAny: same reason as above
          animate(el, { [key]: v } as any, buildAnimateOptions())
        }),
      )
    }

    // Mark first-run state has been consumed (used in tests).
    void wasFirstRun
  })

  onCleanup(() => {
    prevControls?.stop()
  })

  // Phase 2 hooks:
  //   createGestures(el, getOpts)
  //   createDrag(el, getOpts)
}

// Re-export for useMotion to consume the same helpers without circular deps.
export { applyStaticStyle }
