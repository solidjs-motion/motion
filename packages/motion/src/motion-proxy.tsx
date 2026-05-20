import { type Component, type JSX, splitProps } from "solid-js"
import { Dynamic } from "solid-js/web"
import type { ElementProps, MotionOptions } from "./types"
import { useMotion } from "./use-motion"

// ---------------------------------------------------------------------------
// motion proxy — Phase 4.
//
// `motion` is a Proxy whose property accesses return cached, memoized
// tag-components: `motion.div`, `motion.svg`, `motion.path`, etc. Each
// tag-component:
//
//   1. Splits incoming props into motion options (fed to useMotion) and
//      element attributes (forwarded to the underlying element reactively).
//   2. Wires useMotion in its function form so reactive options propagate
//      through to the gesture state machine.
//   3. Wraps the rendered element in `m.Provider` UNCONDITIONALLY so a
//      variant cascade reaches every motion descendant — the canonical
//      motion-react ergonomic (B1 in ADR 0004).
//   4. Renders the actual element through <Dynamic>, which transparently
//      handles SVG-vs-HTML namespace resolution.
//
// The HOC entry point (`motion.create`) lands in the follow-up commit. This
// commit ships only the indexable surface for tag-components.
// ---------------------------------------------------------------------------

/**
 * The exhaustive list of keys that `motion.X` (and `motion.create`,
 * landing next) route to `useMotion` rather than the underlying element.
 * Anything not in this array falls through to `rest` and is spread onto
 * the DOM element via Solid's reactive spread — keeping things like
 * `class`, `onClick`, dynamic style, etc. reactive end-to-end.
 *
 * The `satisfies` clause ensures every entry IS a valid `MotionOptions`
 * key (typos fail to compile). The `_ensureExhaustive` constant below
 * asserts the converse — every `MotionOptions` key appears in this
 * array — so adding a new option to types.ts without registering here
 * fails to compile with the missing key surfaced in the error.
 */
export const MOTION_OPT_KEYS = [
  // Variant slots
  "initial",
  "animate",
  "exit",
  // Gesture targets
  "hover",
  "press",
  "focus",
  "inView",
  "inViewOptions",
  // Drag config
  "drag",
  "dragConstraints",
  "dragElastic",
  "dragMomentum",
  "dragTransition",
  "dragSnapToOrigin",
  "dragControls",
  "whileDrag",
  // Pan
  "panThreshold",
  // Variants + transition
  "variants",
  "custom",
  "transition",
  // Animation lifecycle
  "onAnimationStart",
  "onAnimationComplete",
  "onAnimationCancel",
  "onUpdate",
  // Gesture lifecycle
  "onHoverStart",
  "onHoverEnd",
  "onPressStart",
  "onPress",
  "onPressCancel",
  "onFocus",
  "onBlur",
  "onPanStart",
  "onPan",
  "onPanEnd",
  "onViewportEnter",
  "onViewportLeave",
  // Drag lifecycle
  "onDragStart",
  "onDrag",
  "onDragEnd",
  "onDragTransitionEnd",
] as const satisfies readonly (keyof MotionOptions)[]

// Compile-time exhaustiveness check. If a new MotionOptions key is added
// without being registered above, TypeScript surfaces the missing key by
// name in the error message at this line.
type _MissingMotionOptKeys = Exclude<keyof MotionOptions, (typeof MOTION_OPT_KEYS)[number]>
// Variable prefixed with `_` so biome's noUnusedVariables exempts it —
// the const exists purely so TypeScript evaluates its type and surfaces
// the missing key when the constraint fails.
const _ensureExhaustive: [_MissingMotionOptKeys] extends [never]
  ? true
  : { _missing: _MissingMotionOptKeys } = true

/**
 * The shape of the `motion` proxy: every HTML/SVG intrinsic element name
 * maps to a typed `Component` whose props are that element's native
 * attribute set intersected with {@link MotionOptions}.
 *
 * The HOC entry point (`create`) is added to this type in the follow-up
 * commit alongside its runtime implementation.
 */
export type Motion = {
  [Tag in keyof JSX.IntrinsicElements]: Component<JSX.IntrinsicElements[Tag] & MotionOptions>
}

// Module-level cache. `motion.div` returns the SAME component instance
// across reads, which (a) lets Solid's reconciler skip redundant work and
// (b) keeps component identity stable for HMR + dev tooling.
// Solid's `Component<P>` is constrained to `P extends Record<string, any>`,
// so we use `any` here. The Motion type narrows the per-tag prop shape at
// the call site (motion.div has DivProps & MotionOptions); this storage
// uniformity is purely internal.
// biome-ignore lint/suspicious/noExplicitAny: Component<P> requires P extends Record<string, any>
type AnyComponent = Component<any>

const tagComponentCache = new Map<string, AnyComponent>()

function makeMotionTag(tag: string): AnyComponent {
  const cached = tagComponentCache.get(tag)
  if (cached) return cached

  const Tag: Component<ElementProps & MotionOptions> = (props) => {
    const [motionOpts, rest] = splitProps(props, MOTION_OPT_KEYS)
    const m = useMotion(() => motionOpts)
    return (
      <m.Provider>
        <Dynamic component={tag} {...m(rest as ElementProps)} />
      </m.Provider>
    )
  }
  const stored = Tag as AnyComponent
  tagComponentCache.set(tag, stored)
  return stored
}

/**
 * `motion` — the indexable proxy. Every property access returns a cached
 * motion-aware component for the given HTML/SVG tag.
 *
 * @example HTML element
 * ```tsx
 * <motion.div animate={{ x: 100 }} hover={{ scale: 1.05 }}>
 *   draggable card
 * </motion.div>
 * ```
 *
 * @example SVG element (handled transparently via <Dynamic>)
 * ```tsx
 * <motion.path d="M0 0 L100 100" animate={{ pathLength: 1 }} />
 * ```
 *
 * Non-string keys (Symbols, well-known properties) return `undefined` so
 * debugging tools and `typeof` checks see a sane shape.
 */
export const motion: Motion = new Proxy({} as Motion, {
  get(_target, key) {
    if (typeof key !== "string") return undefined
    return makeMotionTag(key) as never
  },
}) as Motion
