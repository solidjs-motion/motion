import { mergeRefs } from "@solid-primitives/refs"
import { type Component, type JSX, mergeProps, onMount, splitProps } from "solid-js"
import { Dynamic } from "solid-js/web"
import type { ElementProps, MotionElement, MotionOptions, MotionStyle } from "./types"
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
/**
 * Union of every `MotionOptions` key the proxy splits off from element
 * attributes. Hardcoded as a literal union — NOT derived from
 * `typeof MOTION_OPT_KEYS[number]` — so JSR's "slow types" rule can
 * resolve the public type without inferring it from a const.
 *
 * Two compile-time exhaustiveness directions guarantee consistency
 * between this type and the runtime `MOTION_OPT_KEYS` array:
 *
 *   1. `_MissingMotionOptKeys` (below) verifies the union covers every
 *      key in `keyof MotionOptions`.
 *   2. The `satisfies` clause on `MOTION_OPT_KEYS` verifies every array
 *      entry IS a `MotionOptKey` (typo-proof at the runtime layer).
 *
 * If `MotionOptions` grows a new key, both `_MissingMotionOptKeys`
 * AND `splitProps` at runtime break — the type check surfaces the
 * specific missing key by name.
 */
export type MotionOptKey =
  // Variant slots
  | "initial"
  | "animate"
  | "exit"
  // Gesture targets
  | "hover"
  | "press"
  | "focus"
  | "inView"
  | "inViewOptions"
  // Drag config
  | "drag"
  | "dragConstraints"
  | "dragElastic"
  | "dragMomentum"
  | "dragTransition"
  | "dragSnapToOrigin"
  | "dragControls"
  | "dragListener"
  | "whileDrag"
  // Pan
  | "panThreshold"
  // Variants + transition
  | "variants"
  | "custom"
  | "transition"
  // Animation lifecycle
  | "onAnimationStart"
  | "onAnimationComplete"
  | "onAnimationCancel"
  | "onUpdate"
  // Gesture lifecycle
  | "onHoverStart"
  | "onHoverEnd"
  | "onPressStart"
  | "onPress"
  | "onPressCancel"
  | "onFocus"
  | "onBlur"
  | "onPanStart"
  | "onPan"
  | "onPanEnd"
  | "onViewportEnter"
  | "onViewportLeave"
  // Drag lifecycle
  | "onDragStart"
  | "onDrag"
  | "onDragEnd"
  | "onDragTransitionEnd"

/**
 * Frozen list of `MotionOptKey`s — fed to `splitProps` at every
 * tag-component render to separate motion options from element
 * attributes. The `satisfies` clause checks every entry against
 * `MotionOptKey` at compile time so typos / drift between the union
 * and the array surface as errors.
 */
export const MOTION_OPT_KEYS: readonly MotionOptKey[] = [
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
  "dragListener",
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
] as const satisfies readonly MotionOptKey[]

// Compile-time exhaustiveness check (union → keys direction). If a new
// MotionOptions key is added without being registered in MotionOptKey,
// TypeScript surfaces the missing key by name here.
type _MissingMotionOptKeys = Exclude<keyof MotionOptions, MotionOptKey>
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
 * The intersected `{ create: ... }` member adds the HOC entry point. The
 * intersection's explicit `create` field wins over the mapped type's
 * lookup (and there's no HTML/SVG tag named `create`), so `motion.create`
 * is unambiguously typed as the HOC.
 */
export type Motion = {
  // Override each intrinsic element's `style` to accept `MotionStyle` (which
  // adds transform shortcuts + MotionValue variants on top of standard CSS).
  // Without this override, `<motion.div style={{ scale: mv }} />` wouldn't
  // typecheck — the intrinsic `style: JSX.CSSProperties` doesn't know about
  // motion's transform-shortcut keys or MV values.
  [Tag in keyof JSX.IntrinsicElements]: Component<
    Omit<JSX.IntrinsicElements[Tag], "style"> & { style?: MotionStyle } & MotionOptions
  >
} & {
  /**
   * Wrap a custom Component with motion's behavior. The wrapped Component
   * must forward props (specifically `ref` and `style`) to a single DOM
   * element root — either by spreading `{...props}` on its root or by
   * explicitly setting `ref={props.ref}` and `style={props.style}`. Solid
   * doesn't have `forwardRef`; the contract is enforced by convention and
   * a dev-mode runtime warning if motion's ref never reaches the DOM.
   *
   * @example
   * ```tsx
   * function MyCard(props) {
   *   return <div {...props}>{props.children}</div>
   * }
   * const Animated = motion.create(MyCard)
   * <Animated animate={{ x: 100 }} hover={{ scale: 1.05 }} class="card" />
   * ```
   */
  // biome-ignore lint/suspicious/noExplicitAny: Solid's Component<P> requires P extends Record<string, any>
  create: <P extends Record<string, any>>(Component: Component<P>) => Component<P & MotionOptions>
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

// WeakSet of every component the proxy has manufactured (tag-components AND
// HOC-wrapped components). Used for the dev-mode `motion.create(motion.X)`
// double-wrap warning. WeakSet so HMR-replaced components don't pin their
// predecessors alive.
const motionComponents = new WeakSet<object>()

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
  motionComponents.add(stored)
  return stored
}

/**
 * `motion.create(Component)` — wraps a custom Component with motion's
 * behavior. The wrapped Component must forward props to a single DOM
 * element root; the contract is documented in the {@link Motion.create}
 * JSDoc above and enforced at runtime (in dev mode) by detecting whether
 * motion's ref ever reaches the DOM after mount.
 */
// biome-ignore lint/suspicious/noExplicitAny: matches Motion.create's generic constraint
function motionCreate<P extends Record<string, any>>(
  Component: Component<P>,
): Component<P & MotionOptions> {
  // Dev-mode `motion.create(motion.X)` warning. Double-wrapping puts two
  // motion state machines on the SAME root element — both register with
  // Presence, both dispatch animate() writes, and the resulting writes
  // race. Users almost always meant to compose options at one layer.
  if (
    process.env.NODE_ENV !== "production" &&
    motionComponents.has(Component as unknown as object)
  ) {
    console.warn(
      "[solidjs-motion] motion.create(motion.X) double-wraps the same element " +
        "with two motion state machines. Compose options on a single layer instead.",
    )
  }

  const Wrapped: Component<P & MotionOptions> = (props) => {
    const [motionOpts, rest] = splitProps(
      props as unknown as Record<string, unknown>,
      MOTION_OPT_KEYS,
    )
    const m = useMotion(() => motionOpts as MotionOptions)

    // Dev-mode wrap-validity check (Q7 in the design grill / future ADR
    // 0004): the wrapped Component must forward props.ref to a DOM
    // element so motion's animations and exit registration can actually
    // wire up. We can't enforce this at the type level in Solid (refs
    // are conventionally optional, indistinguishable from "missing"), so
    // we detect at runtime by riding a sentinel through the user-ref
    // slot. `m()`'s internal mergeRefs combines this sentinel with
    // motion's own ref — both fire together when the wrapped Component
    // forwards props.ref to a DOM element. If neither fires after the
    // mount cycle, the wrap is broken.
    //
    // The sentinel-merged ref is computed eagerly (not as a getter) so
    // Solid's spread equality check doesn't churn — refs are stable
    // callbacks set once per mount.
    let refFired = false
    const detector = (_el: MotionElement) => {
      refFired = true
    }
    const userRef = (rest as { ref?: ((el: MotionElement) => void) | MotionElement }).ref
    const mergedUserRef =
      process.env.NODE_ENV !== "production"
        ? mergeRefs(userRef as ((el: MotionElement) => void) | undefined, detector)
        : userRef
    const restWithDetector =
      process.env.NODE_ENV !== "production" ? mergeProps(rest, { ref: mergedUserRef }) : rest

    if (process.env.NODE_ENV !== "production") {
      onMount(() => {
        // Defer one microtask so any synchronous-but-deep ref chain has
        // had a chance to fire. Solid's createRenderEffect runs refs
        // during the synchronous mount, but the Component might wrap
        // its DOM root in another <Show>-like deferral.
        queueMicrotask(() => {
          if (!refFired) {
            console.warn(
              "[solidjs-motion] motion.create wrapped a Component whose root " +
                "didn't receive motion's ref. The wrapped Component must " +
                "either spread {...props} on a single DOM element OR " +
                "explicitly forward `props.ref` to its root. Motion's " +
                "animations and exit registration won't run until this " +
                "is fixed.",
            )
          }
        })
      })
    }

    return (
      <m.Provider>
        <Component {...(m(restWithDetector as ElementProps) as unknown as P)} />
      </m.Provider>
    )
  }
  motionComponents.add(Wrapped)
  return Wrapped
}

/**
 * `motion` — the indexable proxy. Every property access returns a cached
 * motion-aware component for the given HTML/SVG tag. The reserved
 * `motion.create` key returns the HOC entry point.
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
 * @example Wrapping a custom Component via the HOC
 * ```tsx
 * const Animated = motion.create(MyCard)
 * <Animated animate={{ scale: 1.05 }} class="my-card" />
 * ```
 *
 * Non-string keys (Symbols, well-known properties) return `undefined` so
 * debugging tools and `typeof` checks see a sane shape.
 */
export const motion: Motion = new Proxy({} as Motion, {
  get(_target, key) {
    if (typeof key !== "string") return undefined
    if (key === "create") return motionCreate
    return makeMotionTag(key) as never
  },
}) as Motion
