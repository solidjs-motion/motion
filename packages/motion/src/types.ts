import type {
  AnimationPlaybackControls,
  MotionValue,
  PanInfo,
  PressGestureInfo,
  ResolvedValues,
  SpringOptions,
  Transition,
} from "motion"
import type { Accessor, Component, JSX } from "solid-js"

// ---------------------------------------------------------------------------
// Re-exports from motion. These are the upstream types we adopt as-is so the
// migration story stays clean and our wrappers don't drift from the engine.
// ---------------------------------------------------------------------------

export type {
  AnimationPlaybackControls,
  MotionValue,
  PanInfo,
  ResolvedValues,
  SpringOptions,
  Transition,
}

/**
 * Callable {@link MotionValue} — has every MotionValue method (`.get`, `.set`,
 * `.jump`, `.on`, `.getVelocity`, ...) AND can be invoked as a Solid-tracked
 * Accessor. Returned by `createMotionValue`, `createTransform`,
 * `createSpring`, `createTime`, `createVelocity`, and `createTemplate`.
 *
 * - `mv()` — Solid-tracked read (use in JSX, `createEffect`, `createMemo`)
 * - `mv.get()` — sync untracked read (motion engine's API; matches motion/react)
 * - `mv.set(v)` / `mv.jump(v)` — imperative writes (also trigger the Solid
 *   signal via an internal `mv.on("change", ...)` bridge)
 *
 * Passes motion's `isMotionValue` (duck-typed on `.getVelocity`), so the same
 * value can be used as a target in `useMotion({ animate: { x: mv } })` or as
 * the target of `animate(mv, 100)`.
 */
export type MotionValueAccessor<T> = MotionValue<T> & (() => T)

/** Per-press info delivered to onPressStart / onPress / onPressCancel. */
export type PressInfo = PressGestureInfo

/**
 * Imperative drag controls returned from createDragControls(). Defined locally
 * because motion's public `motion` export doesn't surface its DragControls
 * class type. Phase 2 instantiates and exports the concrete implementation.
 */
export type DragControls = {
  /** Begin a drag from an externally-captured pointer event. */
  start: (event: PointerEvent) => void
}

// ---------------------------------------------------------------------------
// Value types — a property's value can be a literal, a MotionValue, or a Solid
// Accessor. Motion's engine subscribes to MotionValues natively; Accessors are
// snapshotted at effect time.
// ---------------------------------------------------------------------------

type Numeric = number | MotionValue<number> | Accessor<number>
type Stringish = string | MotionValue<string> | Accessor<string>
type AnyValue = Numeric | Stringish

/** A property value or an array of values (keyframe sequence). */
export type Keyframes<T> = T | T[]

// ---------------------------------------------------------------------------
// Target — strict transform shorthand + index signature for arbitrary CSS.
// Plain values, MotionValues, and Accessors all accepted. A `transition` key
// can also be present for per-target transition overrides.
// ---------------------------------------------------------------------------

export type Target = {
  // Translate shorthand (px when number)
  x?: Keyframes<Numeric | Stringish>
  y?: Keyframes<Numeric | Stringish>
  z?: Keyframes<Numeric | Stringish>

  // Scale (dimensionless)
  scale?: Keyframes<Numeric>
  scaleX?: Keyframes<Numeric>
  scaleY?: Keyframes<Numeric>
  scaleZ?: Keyframes<Numeric>

  // Rotate (deg when number)
  rotate?: Keyframes<Numeric | Stringish>
  rotateX?: Keyframes<Numeric | Stringish>
  rotateY?: Keyframes<Numeric | Stringish>
  rotateZ?: Keyframes<Numeric | Stringish>

  // Skew (deg when number)
  skew?: Keyframes<Numeric | Stringish>
  skewX?: Keyframes<Numeric | Stringish>
  skewY?: Keyframes<Numeric | Stringish>

  // Transform-related but not shorthand
  transformPerspective?: Keyframes<Numeric>
  transformOrigin?: Stringish

  // Common CSS with narrowed types
  opacity?: Keyframes<Numeric>
  zIndex?: Keyframes<Numeric>

  // Per-target transition override (Q3 sub-3)
  transition?: Transition

  // Catch-all for arbitrary CSS (incl. CSS variables like "--foo").
  // Index signature must accept every named property above, plus Transition.
  [key: string]: Keyframes<AnyValue> | Transition | undefined
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

/** A single variant — a target shape, or a function producing one from `custom`. */
export type Variant = Target | ((custom: unknown) => Target)

/** A named map of variants. */
export type Variants = Record<string, Variant>

/** What can be passed where a variant name is expected (string, array of strings). */
export type VariantLabels = string | string[]

/** What can drive an animation: a target object, a variant name, or an array of names. */
export type AnimateValue = Target | VariantLabels

// ---------------------------------------------------------------------------
// Viewport / IntersectionObserver options for inView gesture and createInView.
// ---------------------------------------------------------------------------

export type ViewportOptions = {
  /** Stop observing after first entry (default false). */
  once?: boolean
  /** rootMargin string passed to IntersectionObserver. */
  margin?: string
  /** Threshold; "some" = any intersection, "all" = fully visible, or number 0–1. */
  amount?: "some" | "all" | number
  /** Solid-style accessor returning the root element; defaults to viewport. */
  root?: () => Element | null
}

// ---------------------------------------------------------------------------
// Drag options
// ---------------------------------------------------------------------------

export type DragConstraints =
  | { top?: number; left?: number; right?: number; bottom?: number }
  | { current: HTMLElement | null }

export type DragOptions = {
  drag?: boolean | "x" | "y"
  dragConstraints?: DragConstraints
  /** Elastic resistance past constraints (0–1, default 0.5). */
  dragElastic?: number
  /** Carry momentum after release (default true). */
  dragMomentum?: boolean
  /** Spring options applied to the momentum-snap-back animation. */
  dragTransition?: SpringOptions
  /** Snap back to origin on release (default false). */
  dragSnapToOrigin?: boolean
  /** Imperatively-triggered drag (from createDragControls). */
  dragControls?: DragControls
}

// ---------------------------------------------------------------------------
// Lifecycle callbacks. Every hook is typed in Phase 1; only the animation-
// lifecycle ones (start/complete/cancel/update) are wired in Phase 1. Gesture
// and drag hooks fire when those features land in Phase 2.
// ---------------------------------------------------------------------------

export type MotionCallbacks = {
  // Animation lifecycle (Phase 1)
  onAnimationStart?: () => void
  onAnimationComplete?: (definition: AnimateValue) => void
  onAnimationCancel?: () => void
  onUpdate?: (latest: ResolvedValues) => void

  // Gesture lifecycle (Phase 2)
  onHoverStart?: (e: PointerEvent) => void
  onHoverEnd?: (e: PointerEvent) => void
  onPressStart?: (e: PointerEvent, info: PressInfo) => void
  onPress?: (e: PointerEvent, info: PressInfo) => void
  onPressCancel?: (e: PointerEvent, info: PressInfo) => void
  onFocus?: (e: FocusEvent) => void
  onBlur?: (e: FocusEvent) => void
  onPanStart?: (e: PointerEvent, info: PanInfo) => void
  onPan?: (e: PointerEvent, info: PanInfo) => void
  onPanEnd?: (e: PointerEvent, info: PanInfo) => void
  onViewportEnter?: (entry: IntersectionObserverEntry) => void
  onViewportLeave?: (entry: IntersectionObserverEntry) => void

  // Drag lifecycle (Phase 2)
  onDragStart?: (e: PointerEvent, info: PanInfo) => void
  onDrag?: (e: PointerEvent, info: PanInfo) => void
  onDragEnd?: (e: PointerEvent, info: PanInfo) => void
  onDragTransitionEnd?: () => void
}

// ---------------------------------------------------------------------------
// MotionOptions — the full options bag accepted by useMotion / createMotion /
// <motion.div> / motion(). Includes animation targets, gesture targets,
// drag config, variants, callbacks, custom prop.
// ---------------------------------------------------------------------------

export type MotionOptions = MotionCallbacks &
  DragOptions & {
    /** Starting state. `false` means "don't apply an initial style". */
    initial?: AnimateValue | false
    /** Target the element animates to. */
    animate?: AnimateValue
    /** Target applied when component unmounts inside <Presence>. */
    exit?: AnimateValue

    /** Hover gesture target. */
    hover?: AnimateValue
    /** Press gesture target. */
    press?: AnimateValue
    /** Focus gesture target. */
    focus?: AnimateValue
    /** Viewport gesture target. */
    inView?: AnimateValue
    /** Viewport observer config for the inView gesture. */
    inViewOptions?: ViewportOptions

    /** Default transition applied to every property in animate/gesture targets. */
    transition?: Transition

    /** Named variant map; resolved by variant name in animate/gesture targets. */
    variants?: Variants

    /** Value passed to function variants. */
    custom?: unknown
  }

// ---------------------------------------------------------------------------
// useMotion return type — a getter function that merges user props with
// motion's props (style, ref, hydration marker), plus a Provider component
// for opt-in variant context propagation to descendants.
// ---------------------------------------------------------------------------

export type ElementProps = JSX.HTMLAttributes<HTMLElement> & {
  ref?: ((el: HTMLElement) => void) | HTMLElement | undefined
  style?: JSX.CSSProperties
}

export type MotionMergedProps<P extends ElementProps> = Omit<P, "ref" | "style"> & {
  style: JSX.CSSProperties
  ref: (el: HTMLElement) => void
  "data-motion-hydrated"?: ""
}

export type MotionGetProps = <P extends ElementProps>(userProps?: P) => MotionMergedProps<P>

export type UseMotionResult = MotionGetProps & {
  /** Opt-in: wrap descendant motion elements to receive this element's variant context. */
  Provider: Component<{ children: JSX.Element }>
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

/** Propagates the variant state from a parent motion element to descendants. */
export type VariantContextValue = {
  variants?: Accessor<Variants | undefined>
  /** Propagated only when the parent's `initial` is a variant name (not `false` or an explicit Target). */
  initial?: Accessor<VariantLabels | undefined>
  animate?: Accessor<VariantLabels | undefined>
  hover?: Accessor<VariantLabels | undefined>
  press?: Accessor<VariantLabels | undefined>
  focus?: Accessor<VariantLabels | undefined>
  inView?: Accessor<VariantLabels | undefined>
  exit?: Accessor<VariantLabels | undefined>
  custom?: Accessor<unknown>
  transition?: Accessor<Transition | undefined>
}

/** Wired in Phase 1 with no-op default; <Presence> swaps it in Phase 3. */
export type PresenceContextValue = {
  register: (el: HTMLElement, exit: AnimateValue, transition?: Transition) => void
  unregister: (el: HTMLElement) => void
  beforeUnmount: (el: HTMLElement) => Promise<void>
}

/** <MotionConfig> provides defaults that flow to every descendant motion element. */
export type MotionConfigContextValue = {
  /** "always" forces snap; "never" ignores system pref; "user" respects prefers-reduced-motion. */
  reducedMotion: Accessor<"always" | "never" | "user">
  /** Default transition merged with descendant transitions (descendant wins on conflict). */
  transition: Accessor<Transition | undefined>
  /** CSP nonce applied to any inline style emissions (advanced). */
  nonce: Accessor<string | undefined>
}

// ---------------------------------------------------------------------------
// MotionConfig component props
// ---------------------------------------------------------------------------

export type MotionConfigProps = {
  reducedMotion?: "always" | "never" | "user"
  transition?: Transition
  nonce?: string
  children: JSX.Element
}
