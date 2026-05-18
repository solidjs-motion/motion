import { mergeRefs } from "@solid-primitives/refs"
import { type Component, type JSX, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { asVariantLabels, createMotion, resolveTarget } from "./primitives/createMotion"
import type { GestureStateName } from "./primitives/gesture-state"
import { targetToStyle } from "./style"
import type {
  ElementProps,
  MotionMergedProps,
  MotionOptions,
  Target,
  Transition,
  UseMotionResult,
  VariantContextValue,
  Variants,
} from "./types"
import { isControllingVariants, useVariantContext, VariantContext } from "./variants"

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

  // ---------- Parent context (with controlling-variants shadowing) ----------
  // Mirrors motion-dom's isControllingVariants check: when THIS node has any
  // variant *label* prop (initial/animate/hover/press/focus/inView/exit as a
  // string), it opts OUT of inheriting from its parent. The wrapped context's
  // slots return undefined while controlling, so the state machine and the
  // initial-target resolver see no inherited values to fall back on.
  //
  // The wrap is reactive — if opts toggle in/out of controlling state, the
  // slots automatically flip between actual-parent and undefined.
  const actualParentCtx: VariantContextValue = useVariantContext()
  const isControlling = (): boolean => isControllingVariants(getOpts())
  const parentVariantCtx: VariantContextValue = {
    variants: () => (isControlling() ? undefined : actualParentCtx.variants?.()),
    initial: () => (isControlling() ? undefined : actualParentCtx.initial?.()),
    animate: () => (isControlling() ? undefined : actualParentCtx.animate?.()),
    hover: () => (isControlling() ? undefined : actualParentCtx.hover?.()),
    press: () => (isControlling() ? undefined : actualParentCtx.press?.()),
    focus: () => (isControlling() ? undefined : actualParentCtx.focus?.()),
    inView: () => (isControlling() ? undefined : actualParentCtx.inView?.()),
    exit: () => (isControlling() ? undefined : actualParentCtx.exit?.()),
    custom: () => (isControlling() ? undefined : actualParentCtx.custom?.()),
    transition: () => (isControlling() ? undefined : actualParentCtx.transition?.()),
  }

  // ---------- Compute the SSR-emittable initial style ----------
  // untrack so reading getOpts() during render doesn't subscribe a Solid
  // computation; the createMotion effect inside motionRef owns reactivity.
  const initialOpts = untrack(getOpts)
  const initialStyle = computeInitialStyle(initialOpts, parentVariantCtx)

  // ---------- Active gesture flags (Q4) ----------
  // Lifted from inside the state machine so myVariantCtx below can gate its
  // gesture label slots on these flags. createMotion (via the ref) threads
  // this same store into the state machine so both sides share state.
  const activeStore = createStore<Record<GestureStateName, boolean>>({
    animate: true,
    whileInView: false,
    whileHover: false,
    whilePress: false,
    whileFocus: false,
    whileDrag: false,
    exit: false,
  })
  const [active] = activeStore

  // ---------- Build the motion ref ----------
  // Pass the shadowed parent context to createMotion so its state machine
  // and initial-target resolver consume the same controlling-aware view.
  const motionRef = (el: HTMLElement) => {
    createMotion(el, getOpts, {
      initialAppliedBySSR: !!initialStyle,
      activeStore,
      parentContext: parentVariantCtx,
    })
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
  //
  // Q4 — gesture slots (hover, press, focus, inView) are ACTIVE-GATED:
  // they return the label only when the corresponding gesture flag is true.
  // When inactive, they return undefined — so descendants' priority chains
  // correctly skip the inherited entry. The non-gesture slots (animate,
  // initial, exit, custom, transition, variants) propagate unconditionally.
  const myVariantCtx: VariantContextValue = {
    variants: () => getOpts().variants,
    // `initial: false` is a parent-only opt-out — don't propagate it. Only
    // variant names (string / string[]) propagate to descendants.
    initial: () => {
      const v = getOpts().initial
      return v === false ? undefined : asVariantLabels(v)
    },
    animate: () => asVariantLabels(getOpts().animate),
    hover: () => (active.whileHover ? asVariantLabels(getOpts().hover) : undefined),
    press: () => (active.whilePress ? asVariantLabels(getOpts().press) : undefined),
    focus: () => (active.whileFocus ? asVariantLabels(getOpts().focus) : undefined),
    inView: () => (active.whileInView ? asVariantLabels(getOpts().inView) : undefined),
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

  // Priority chain for the initial-state target:
  //   own.initial > parent.initial > own.animate > parent.animate
  // Each level is consulted only if the previous is undefined. This matches
  // motion/react's variant-context behavior — children without their own
  // initial/animate props inherit from the ancestor motion element.
  const inheritedInitial = parentVariantCtx.initial?.()
  const inheritedAnimate = parentVariantCtx.animate?.()
  const effective =
    opts.initial !== undefined
      ? opts.initial
      : inheritedInitial !== undefined
        ? inheritedInitial
        : opts.animate !== undefined
          ? opts.animate
          : inheritedAnimate
  if (effective === undefined) return null

  const target = resolveTarget(
    effective,
    opts.variants as Variants | undefined,
    undefined, // priority chain already consumed parent's labels
    opts.custom ?? parentVariantCtx.custom?.(),
  )
  return target ? targetToStyle(target as Target) : null
}

// Re-export Transition for downstream consumers that destructure from useMotion's module.
export type { Transition }
