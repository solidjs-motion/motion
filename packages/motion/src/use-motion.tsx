import { mergeRefs } from "@solid-primitives/refs"
import { type Component, type JSX, untrack } from "solid-js"
import { asVariantLabels, createMotion, resolveTarget } from "./primitives/createMotion"
import { targetToStyle } from "./style"
import type {
  ElementProps,
  MotionMergedProps,
  MotionOptions,
  Target,
  Transition,
  UseMotionResult,
  VariantContextValue,
  VariantLabels,
  Variants,
} from "./types"
import { useVariantContext, VariantContext } from "./variants"

// ---------------------------------------------------------------------------
// useMotion — the canonical public API. Returns a getter that merges user
// props with motion's (style, ref, hydration marker) and a Provider for
// opt-in variant context propagation (Q4 sub-3 Option B).
// ---------------------------------------------------------------------------

/**
 * Wire motion to an element via a getter function.
 *
 * ```tsx
 * const motion = useMotion({
 *   initial: { opacity: 0, y: 20 },
 *   animate: { opacity: 1, y: 0 },
 *   transition: { duration: 0.6 },
 * })
 *
 * <div {...motion({ class: "card" })}>Hello</div>
 * ```
 *
 * **Reactive form**: pass a function to track signals.
 * ```tsx
 * useMotion(() => ({ animate: { x: x() } }))
 * ```
 *
 * **Variant context propagation**: `useMotion` only *consumes* the parent
 * variant context. To propagate to descendants, wrap them in `motion.Provider`:
 * ```tsx
 * const m = useMotion({ animate: "visible", variants })
 * <div {...m()}>
 *   <m.Provider>
 *     <ChildMotion />
 *   </m.Provider>
 * </div>
 * ```
 *
 * For the common "JSX wrapper does propagation automatically" pattern, use
 * `<motion.div>` (Phase 4).
 */
export function useMotion(opts: MotionOptions | (() => MotionOptions)): UseMotionResult {
  const getOpts: () => MotionOptions = typeof opts === "function" ? opts : () => opts
  const parentVariantCtx: VariantContextValue = useVariantContext()

  // ---------- Compute the SSR-emittable initial style ----------
  // untrack so reading getOpts() during render doesn't subscribe a Solid
  // computation; the createMotion effect inside motionRef owns reactivity.
  const initialOpts = untrack(getOpts)
  const initialStyle = computeInitialStyle(initialOpts, parentVariantCtx)

  // ---------- Build the motion ref ----------
  const motionRef = (el: HTMLElement) => {
    createMotion(el, getOpts, { initialAppliedBySSR: !!initialStyle })
  }

  // ---------- The getter that merges user props with motion's ----------
  function getProps<P extends ElementProps>(userProps?: P): MotionMergedProps<P> {
    const merged: Record<string, unknown> = {
      ...(userProps ?? {}),
      // Motion wins style conflicts (Q2 sub-1): user style first, motion's overrides.
      style: { ...(userProps?.style ?? {}), ...(initialStyle ?? {}) },
      ref: mergeRefs(userProps?.ref, motionRef),
    }
    if (initialStyle) merged["data-motion-hydrated"] = ""
    return merged as MotionMergedProps<P>
  }

  // ---------- Provider for opt-in variant context propagation ----------
  // Accessors recompute on each call so the provided context tracks the live
  // options (variant name changes propagate to descendants).
  const myVariantCtx: VariantContextValue = {
    variants: () => getOpts().variants,
    animate: () => asVariantLabels(getOpts().animate),
    hover: () => asVariantLabels(getOpts().hover),
    press: () => asVariantLabels(getOpts().press),
    focus: () => asVariantLabels(getOpts().focus),
    inView: () => asVariantLabels(getOpts().inView),
    exit: () => asVariantLabels(getOpts().exit),
    custom: () => getOpts().custom,
    transition: () => getOpts().transition,
  }

  const Provider: Component<{ children: JSX.Element }> = (props) => (
    <VariantContext.Provider value={myVariantCtx}>{props.children}</VariantContext.Provider>
  )

  // Attach Provider to the callable function. Object.assign merges types
  // cleanly for callable-with-properties — TS infers the intersection.
  return Object.assign(getProps, { Provider })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeInitialStyle(
  opts: MotionOptions,
  parentVariantCtx: VariantContextValue,
): JSX.CSSProperties | null {
  if (opts.initial === false) return null

  const initialAnimateValue = opts.initial ?? opts.animate
  if (initialAnimateValue === undefined) return null

  const target = resolveTarget(
    initialAnimateValue,
    opts.variants as Variants | undefined,
    parentVariantCtx.animate?.() as VariantLabels | undefined,
    opts.custom ?? parentVariantCtx.custom?.(),
  )
  return target ? targetToStyle(target as Target) : null
}

// Re-export Transition for downstream consumers that destructure from useMotion's module.
export type { Transition }
