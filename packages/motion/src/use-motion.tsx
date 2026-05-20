import { mergeRefs } from "@solid-primitives/refs"
import { type Accessor, type Component, type JSX, mergeProps, onMount, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { usePresenceContext } from "./presence-context"
import { asVariantLabels, createMotion, resolveTarget } from "./primitives/createMotion"
import type { GestureStateName } from "./primitives/gesture-state"
import { targetToStyle } from "./style"
import type {
  ElementProps,
  MotionElement,
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
  //
  // We also peek at the surrounding `<Presence>` (if any). When `initial`
  // is propagated as `false`, the descendant should mount painted at the
  // animate target — not the initial — because we WANT the visual end state
  // to match a normal post-animation appearance, just without the animation.
  // computeInitialStyle reads `presence.initial` once at construction; the
  // signal flips to true on a microtask, but by then the SSR style has
  // been computed and merged into the JSX props.
  const presenceCtx = usePresenceContext()
  const initialOpts = untrack(getOpts)
  const initialStyle = computeInitialStyle(initialOpts, parentVariantCtx, presenceCtx.initial)

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
  const motionRef = (el: MotionElement) => {
    createMotion(el, getOpts, {
      initialAppliedBySSR: !!initialStyle,
      activeStore,
      parentContext: parentVariantCtx,
    })
  }

  // ---------- The getter that merges user props with motion's ----------
  // Built on Solid's `mergeProps` rather than an eager object spread. The
  // returned value is a reactive proxy: reads against any property defer to
  // its source, so reactive non-motion props the user spreads through `m()`
  // (e.g. `<div {...m({ class: signal() ? "on" : "off" })}>`) keep their
  // reactivity through to the rendered element. The previous spread-based
  // implementation snapshotted userProps at call time, which broke this
  // path for the Phase 4 motion proxy.
  //
  // `initialStyle` is included in the `style` getter ONLY before the
  // first render completes. After onMount fires, motion's WAA owns the
  // animated properties on the element — if we kept layering initialStyle
  // into m()'s reactive output, Solid's style fn (which re-applies every
  // tracked key via setProperty on each render — its first-loop deletes
  // every prev entry, so the second loop's `v !== prev[s]` is always true)
  // would re-write the static initial values back into the inline style on
  // every reactive prop change, clobbering whatever WAA committed. Server-
  // side, onMount never fires, so renderedOnce stays false and initialStyle
  // always reaches the SSR HTML for first-paint correctness. Client first
  // render runs BEFORE the onMount microtask, so initialStyle is also in
  // the JSX for hydration consistency with the SSR HTML.
  //
  // `ref` is computed once and snapshotted — refs are conventionally
  // callbacks set once per mount; re-running mergeRefs on each read is
  // wasted work.
  let renderedOnce = false
  onMount(() => {
    renderedOnce = true
  })
  function getProps<P extends ElementProps>(userProps?: P): MotionMergedProps<P> {
    return mergeProps(userProps ?? {}, {
      get style() {
        if (renderedOnce) return (userProps?.style ?? {}) as JSX.CSSProperties
        return { ...(userProps?.style ?? {}), ...(initialStyle ?? {}) }
      },
      ref: mergeRefs(userProps?.ref, motionRef),
      ...(initialStyle ? { "data-motion-hydrated": "" } : {}),
    }) as MotionMergedProps<P>
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
  presenceInitial?: Accessor<boolean>,
): JSX.CSSProperties | null {
  // `<Presence initial={false}>` propagates "skip the enter animation" down
  // to every motion descendant. The intent is "render at the animate target"
  // — NOT "render at the initial target with no animation" (the latter would
  // leave the element looking like it failed to mount). So when the surrounding
  // Presence says "suppress", we compute the style from the animate target
  // instead of the initial chain. The state machine separately skips the
  // first-mount animate dispatch via the same `suppressFirstMount` path.
  if (presenceInitial?.() === false) {
    const animateValue = opts.animate !== undefined ? opts.animate : parentVariantCtx.animate?.()
    if (animateValue === undefined) return null
    const animateTarget = resolveTarget(
      animateValue,
      opts.variants as Variants | undefined,
      undefined,
      opts.custom ?? parentVariantCtx.custom?.(),
    )
    return animateTarget ? targetToStyle(animateTarget as Target) : null
  }

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
