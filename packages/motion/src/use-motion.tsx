import { mergeRefs } from "@solid-primitives/refs"
import { isMotionValue, type MotionValue } from "motion"
import { type Accessor, type Component, type JSX, mergeProps, onMount, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { usePresenceContext } from "./presence-context"
import { asVariantLabels, createMotion, resolveTarget } from "./primitives/createMotion"
import type { GestureStateName } from "./primitives/gesture-state"
import { snapshotValue, TRANSFORM_KEYS, targetToStyle } from "./style"
import type {
  ElementProps,
  MotionElement,
  MotionMergedProps,
  MotionOptions,
  MotionStyle,
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

  // ---------- Compute the SSR-emittable initial target ----------
  // untrack so reading getOpts() during render doesn't subscribe a Solid
  // computation; the createMotion effect inside motionRef owns reactivity.
  //
  // We also peek at the surrounding `<Presence>` (if any). When `initial`
  // is propagated as `false`, the descendant should mount painted at the
  // animate target — not the initial — because we WANT the visual end state
  // to match a normal post-animation appearance, just without the animation.
  // computeInitialTarget reads `presence.initial` once at construction; the
  // signal flips to true on a microtask, but by then the SSR style has
  // been computed and merged into the JSX props.
  //
  // Stage 4 split: this returns the RAW resolved Target rather than the
  // composed CSS. The style getter below composes initialTarget + style MV
  // snapshots together so SSR HTML and client first paint both reflect the
  // MVs the user supplied. Without this split, SSR HTML carries only the
  // initial target and the MV value lands only after the client's ref fires
  // — producing a brief paint discontinuity.
  const presenceCtx = usePresenceContext()
  const initialOpts = untrack(getOpts)
  const initialTarget = computeInitialTarget(initialOpts, parentVariantCtx, presenceCtx.initial)

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

  // ---------- MV-in-style scrape (Stage 2) ----------
  // Walked once on the first m() call (see `getProps` below) and threaded
  // into createMotion via `styleMotionValues`. The contract (locked in the
  // grill): MV references in `style` are STATIC — captured once, not
  // re-scanned on subsequent m() calls. Users who want a reactive MV swap
  // can't do `style: { scale: cond() ? mvA : mvB }`; they animate the MV's
  // value instead.
  //
  // Why capture in m() and not in motionRef: m()'s call is the only point
  // where the user's `style` prop is observable from useMotion's body.
  // motionRef fires later (after JSX evaluates), at which time we no
  // longer have a handle on userProps.
  // Stage 4.5: lazy-allocate both maps. Most elements have no MV-in-style
  // and no static transform shortcut, so allocating these eagerly per
  // `useMotion` call was pure waste. The `??=` in `captureStyleEntries`
  // creates them only on first add; downstream consumers handle the
  // `undefined` case via optional chaining.
  let styleMotionValues: Map<string, MotionValue<unknown>> | undefined
  let styleStaticTransforms: Map<string, number | string> | undefined
  let styleCaptured = false

  // ---------- Build the motion ref ----------
  // Pass the shadowed parent context to createMotion so its state machine
  // and initial-target resolver consume the same controlling-aware view.
  //
  // Stage 4: `initialAppliedBySSR` is now true when EITHER we emitted an
  // initial target into the SSR style OR at least one style MV's snapshot
  // landed in the SSR HTML via the style getter below. createMotion uses
  // this flag to skip its own applyStaticStyle pass — without the
  // styleMotionValues branch it would re-apply only the initialTarget half
  // and clobber the MV-snapshot half that's already in the inline style.
  const motionRef = (el: MotionElement) => {
    createMotion(el, getOpts, {
      initialAppliedBySSR:
        initialTarget !== null ||
        styleMotionValues !== undefined ||
        styleStaticTransforms !== undefined,
      activeStore,
      parentContext: parentVariantCtx,
      styleMotionValues,
      styleStaticTransforms,
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

  /**
   * Walk `style` once and pull `MotionValue` refs into `styleMotionValues`.
   * Idempotent across re-renders — Stage 2's contract is "MV refs in style
   * are captured on first call and never re-scraped." Subsequent m()
   * invocations that pass a different style with new MVs won't pick them
   * up; that pattern wasn't in scope for v0.1.
   *
   * The read is `untrack`ed because m() is typically called from inside a
   * JSX spread, which Solid evaluates within a tracked owner. Without
   * untrack we'd subscribe to whatever signals the user's `style` object
   * references and re-fire this useMotion's owner-level effects on every
   * change.
   */
  const captureStyleEntries = (style: unknown): void => {
    if (styleCaptured) return
    styleCaptured = true
    if (!style || typeof style !== "object") return
    for (const key in style) {
      const value = (style as Record<string, unknown>)[key]
      if (isMotionValue(value)) {
        if (!styleMotionValues) styleMotionValues = new Map()
        styleMotionValues.set(key, value as MotionValue<unknown>)
      } else if (TRANSFORM_KEYS.has(key)) {
        // Static transform shortcut. Stage 4 lands these in the registry as
        // transients so the writer composes them with style MVs and initial
        // transforms into one transform string. Reduce MV/accessor/array
        // wrappers to a leaf — though by this branch we already know it's
        // not an MV. The reduction also rejects boolean/object junk values.
        const snap = snapshotValue(value)
        if (snap !== undefined) {
          if (!styleStaticTransforms) styleStaticTransforms = new Map()
          styleStaticTransforms.set(key, snap)
        }
      }
    }
  }

  /**
   * Produce a style object with MV-valued keys (and transform-shortcut keys —
   * see below) removed. Solid's style binding would otherwise either write the
   * MotionValue instance as a literal (coercing it via String() to
   * "[object Object]") for MV-valued entries, or apply transform shortcuts
   * directly as bogus CSS properties for static-shortcut entries. createMotion
   * handles both via the registry-write path; we strip them here so the
   * Solid-bound `cleaned` style only contains regular CSS keys.
   */
  const stripStyleEntriesOwnedByRegistry = (style: MotionStyle | undefined): JSX.CSSProperties => {
    if (!style) return {}
    const out: Record<string, unknown> = {}
    for (const key in style) {
      if (styleMotionValues?.has(key)) continue
      if (TRANSFORM_KEYS.has(key)) continue
      out[key] = (style as Record<string, unknown>)[key]
    }
    return out as JSX.CSSProperties
  }

  /**
   * Stage 4 — compose the first-paint inline style from:
   *   1. `initialTarget` (resolved via the priority chain at construction)
   *   2. MotionValue snapshots from `style: { key: mv }`
   *   3. Static transform shortcuts in `style: { x: 10, scale: 0.5 }`
   *
   * Style entries (2, 3) override `initialTarget` (1) on the same key because
   * `style` is the runtime source-of-truth for those keys. Returns the composed
   * `JSX.CSSProperties` or null when nothing applies (no initial + no style
   * registry contributions).
   *
   * Called only before `onMount` flips `renderedOnce`. After mount, the
   * registry's writer (in createMotion) owns el.style directly and this
   * function isn't consulted.
   */
  const composeFirstPaintStyle = (userStyle: MotionStyle | undefined): JSX.CSSProperties | null => {
    const merged: Record<string, unknown> = {}
    let hasAny = false
    if (initialTarget) {
      Object.assign(merged, initialTarget)
      hasAny = true
    }
    // MV snapshots from style override initialTarget for the same key.
    if (styleMotionValues) {
      for (const [key, mv] of styleMotionValues) {
        merged[key] = mv.get()
        hasAny = true
      }
    }
    // Static transform shortcuts in style (NOT captured as MVs) override too.
    if (userStyle) {
      for (const key in userStyle) {
        if (styleMotionValues?.has(key)) continue
        if (!TRANSFORM_KEYS.has(key)) continue
        const v = (userStyle as Record<string, unknown>)[key]
        if (typeof v === "number" || typeof v === "string") {
          merged[key] = v
          hasAny = true
        }
      }
    }
    return hasAny ? targetToStyle(merged as Target) : null
  }

  function getProps<P extends ElementProps>(userProps?: P): MotionMergedProps<P> {
    untrack(() => captureStyleEntries(userProps?.style))
    // Decide marker presence at call time. Determining this from
    // `getProps` (rather than recomputing per style-getter read) keeps it
    // a stable attribute key on the mergeProps source object.
    const wroteFirstPaintStyle =
      initialTarget !== null ||
      styleMotionValues !== undefined ||
      styleStaticTransforms !== undefined
    return mergeProps(userProps ?? {}, {
      get style() {
        const cleaned = stripStyleEntriesOwnedByRegistry(userProps?.style)

        // Drag-friendly `touch-action` default for any drag-configured
        // element. Without this, the mobile browser arbitrates the
        // gesture as native scroll/zoom and may fire `pointercancel`
        // before motion's own `touch-action` write (inside
        // handlePanStart) can take effect — which would manifest as
        // either a missed drag or a panEnd dispatched with stale
        // offset data. Setting it at render time, before the browser
        // ever sees a pointer event, closes that race.
        //
        // axis "x" → "pan-y" (browser may still scroll the page
        // vertically), axis "y" → "pan-x", otherwise → "none".
        //
        // Goes FIRST in the spread order so user-supplied
        // `style: { touchAction: "auto" }` overrides this default.
        const dragOpts = getOpts().drag
        const dragTouchAction = dragOpts
          ? dragOpts === "x"
            ? "pan-y"
            : dragOpts === "y"
              ? "pan-x"
              : "none"
          : undefined

        const baseWithDefaults = dragTouchAction
          ? { "touch-action": dragTouchAction, ...cleaned }
          : cleaned

        if (renderedOnce) return baseWithDefaults
        const composed = composeFirstPaintStyle(userProps?.style)
        return composed ? { ...baseWithDefaults, ...composed } : baseWithDefaults
      },
      ref: mergeRefs(userProps?.ref, motionRef),
      ...(wroteFirstPaintStyle ? { "data-motion-hydrated": "" } : {}),
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

function computeInitialTarget(
  opts: MotionOptions,
  parentVariantCtx: VariantContextValue,
  presenceInitial?: Accessor<boolean>,
): Target | null {
  // `<Presence initial={false}>` propagates "skip the enter animation" down
  // to every motion descendant. The intent is "render at the animate target"
  // — NOT "render at the initial target with no animation" (the latter would
  // leave the element looking like it failed to mount). So when the surrounding
  // Presence says "suppress", we resolve the animate target as the initial
  // instead of walking the initial chain. The state machine separately skips
  // the first-mount animate dispatch via the same `suppressFirstMount` path.
  if (presenceInitial?.() === false) {
    const animateValue = opts.animate !== undefined ? opts.animate : parentVariantCtx.animate?.()
    if (animateValue === undefined) return null
    return resolveTarget(
      animateValue,
      opts.variants as Variants | undefined,
      undefined,
      opts.custom ?? parentVariantCtx.custom?.(),
    )
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

  return resolveTarget(
    effective,
    opts.variants as Variants | undefined,
    undefined, // priority chain already consumed parent's labels
    opts.custom ?? parentVariantCtx.custom?.(),
  )
}

// Re-export Transition for downstream consumers that destructure from useMotion's module.
export type { Transition }
