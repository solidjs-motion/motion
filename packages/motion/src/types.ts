import type {
  AnimationPlaybackControls,
  MotionValue,
  PanInfo,
  PressGestureInfo,
  ResolvedValues,
  SpringOptions,
  Transition,
} from "motion"
import type { InertiaOptions } from "motion-dom"
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
 * Options for {@link DragControls.start}.
 *
 * Only `snapToCursor` is exposed for v0.1 (Q9b — anything else can be added
 * non-breakingly later).
 */
export type DragControlsStartOptions = {
  /**
   * When true, center the dragged element under the pointer on drag-start.
   * Useful for "drag handle hand-off" patterns where the handle and the
   * dragged element are distinct — the user clicks the handle and the
   * dragged element jumps to follow the pointer.
   */
  snapToCursor?: boolean
}

/**
 * Imperative drag controls returned from `createDragControls()`. Defined
 * locally because motion's public `motion` export doesn't surface its
 * DragControls class type.
 *
 * Usage (Q9): one controls instance binds to one motion element via
 * `dragControls: controls` in MotionOptions. A separate UI element (e.g., a
 * drag-handle button) captures the pointer event and forwards it via
 * `controls.start(event)`, decoupling the drag-listener element from the
 * element that actually moves.
 */
export type DragControls = {
  /**
   * Begin a drag from an externally-captured pointer event. Bypasses
   * createDrag's threshold gate — drag starts immediately at the event's
   * coordinates (the user explicitly invoked, so no "did they really
   * mean it" hysteresis is needed).
   *
   * No-op when no motion element is currently registered with this
   * controls instance.
   */
  start: (event: PointerEvent, options?: DragControlsStartOptions) => void
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
  /**
   * Threshold(s) at which IntersectionObserver fires its callback.
   *
   * - `"some"` (default) — fires the moment any pixel intersects.
   * - `"all"` — fires only when fully visible.
   * - `number` 0–1 — single threshold; fires at that intersection ratio.
   * - `number[]` — an array of thresholds; fires at each crossing. Use this
   *   for continuous `intersectionRatio` updates (e.g., for scroll-linked
   *   fades). With a single threshold the observer is silent between
   *   crossings, so `entry.intersectionRatio` stays stale.
   */
  amount?: "some" | "all" | number | number[]
  /** Solid-style accessor returning the root element; defaults to viewport. */
  root?: () => Element | null
}

// ---------------------------------------------------------------------------
// Drag options
// ---------------------------------------------------------------------------

/**
 * Drag bounds (Q8). Three shapes:
 *
 * - **Numeric** (`{ top, left, right, bottom }`): absolute MV-value bounds.
 *   Missing keys are unbounded on that side.
 * - **HTMLElement**: container the dragged element must stay inside. Bounds
 *   are computed at drag-start from the container's bounding rect.
 * - **`() => HTMLElement | null`**: Solid-style accessor for a reactive
 *   container ref. Called at drag-start.
 */
export type DragConstraints =
  | { top?: number; left?: number; right?: number; bottom?: number }
  | HTMLElement
  | (() => HTMLElement | null)

export type DragOptions = {
  drag?: boolean | "x" | "y"
  dragConstraints?: DragConstraints
  /** Elastic resistance past constraints (0–1, default 0.5). */
  dragElastic?: number
  /** Carry momentum after release (default true). */
  dragMomentum?: boolean
  /**
   * Options for the momentum / snap-back animation. Inertia by default
   * (Q15d preset). Shallow-merges over the defaults — user fields override
   * any single setting (bounceStiffness, timeConstant, etc.).
   */
  dragTransition?: Partial<InertiaOptions>
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
  /** Press began. `info.success` isn't meaningful yet — see {@link onPress} / {@link onPressCancel}. */
  onPressStart?: (e: PointerEvent) => void
  /** Press completed with the pointer still over the element. */
  onPress?: (e: PointerEvent, info: PressInfo) => void
  /** Press cancelled — pointer left the element before pointer-up. */
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

    /**
     * Visual-state target applied while a drag gesture is active. Like
     * other gesture targets, this can be a Target object or a variant
     * label. Common idiom: `whileDrag: { scale: 1.05 }` for a lift-while-
     * dragging effect — composes with drag's translation via the shared
     * VisualElement (Q5/C-lean).
     */
    whileDrag?: AnimateValue

    /**
     * Minimum cumulative pointer movement (in px) before pan/drag start fires.
     * Distinguishes a pan from a click. Q11a default: 3px (matches motion).
     */
    panThreshold?: number

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

/**
 * The element types `useMotion` can attach to. HTMLElement covers the bulk;
 * SVGElement is included so `motion.path`, `motion.circle`, etc. (Phase 4)
 * thread through without a `ref` type-cast. `createMotion` only uses methods
 * available on both (style, addEventListener, getBoundingClientRect) so the
 * union is honored at runtime. Drag stays HTMLElement-only via an
 * `instanceof` check in createMotion's body — motion-dom's VisualElement
 * layer is HTML-specific.
 */
export type MotionElement = HTMLElement | SVGElement

export type ElementProps = JSX.HTMLAttributes<MotionElement> & {
  ref?: ((el: MotionElement) => void) | MotionElement | undefined
  style?: JSX.CSSProperties
}

export type MotionMergedProps<P extends ElementProps> = Omit<P, "ref" | "style"> & {
  style: JSX.CSSProperties
  ref: (el: MotionElement) => void
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

/**
 * Wired with a no-op default; the real implementation is provided by
 * `<Presence>` and `useAnimatePresence()` in Phase 3.
 *
 * Inverted shape vs. motion-react's `AnimatePresenceProps`: the child
 * registers a `runExit` callable that knows how to animate ITSELF out (closes
 * over its own state machine). Presence just coordinates timing — it doesn't
 * resolve targets or merge transitions. See ADR 0003.
 *
 * - `register(el, runExit)` — called from `createMotion` when `opts.exit` is
 *   set. `runExit` flips the state machine's `exit` flag and awaits the
 *   resulting animate's completion.
 * - `unregister(el)` — Solid `onCleanup` after `register`.
 * - `beforeUnmount(el)` — Presence (or the hook's `exit()`) dispatches to the
 *   registered `runExit`. Returns a resolved promise if no `runExit` is
 *   registered, so non-exit children pass through cleanly.
 * - `initial` — when an enclosing `<Presence initial={false}>` (or the hook
 *   with `initial: false`) is active, descendants suppress their first-mount
 *   animation. Accessor-shaped so the implementation can flip post-mount.
 */
export type PresenceContextValue = {
  register: (el: MotionElement, runExit: () => Promise<void>) => void
  unregister: (el: MotionElement) => void
  beforeUnmount: (el: MotionElement) => Promise<void>
  initial?: Accessor<boolean>
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
