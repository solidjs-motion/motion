import type * as csstype from "csstype"
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

/** A property value or an array of values (keyframe sequence). */
export type Keyframes<T> = T | T[]

// ---------------------------------------------------------------------------
// Target — every CSS property animatable by motion, plus motion-specific
// transform shorthands. Plain values, MotionValues, and Accessors all
// accepted. A `transition` key can also be present for per-target
// transition overrides.
//
// CSS property KEYS come from csstype's camelCase `Properties` interface —
// the same source Solid uses for JSX types — so users get IDE autocomplete
// for every standard, vendor-prefixed, and SVG CSS property. Each property's
// VALUE type is widened to `Keyframes<Numeric | Stringish>` so motion's
// runtime can accept numbers (auto-suffix px/deg), strings (colors,
// gradients, CSS keywords), MotionValues, and Solid Accessors uniformly.
//
// Properties with stricter motion semantics — `opacity` and `zIndex` only
// accept numbers, transforms have shorthand keys — are declared explicitly
// and excluded from the CSS-property map via `Omit` to avoid the wider
// `Numeric | Stringish` weakening them.
// ---------------------------------------------------------------------------

/**
 * Every standard / vendor-prefixed / SVG CSS property name from csstype,
 * widened so motion's animate() accepts our union of value types.
 *
 * Drives IDE autocomplete inside `initial` / `animate` / `hover` / etc.
 * Without this, the Target's old open `[key: string]` index signature
 * accepted everything at the type level but TypeScript had nothing to
 * SUGGEST — users wouldn't know `background-color` or `box-shadow` were
 * supported until they typed the full key.
 *
 * Hyphen-case to match Solid's `style` prop convention (which uses
 * csstype's PropertiesHyphen). A user writing
 * `style: { "background-color": "red" }` naturally extends the same
 * casing to `animate: { "background-color": "blue" }`. Motion's runtime
 * accepts hyphen-case directly; camelCase keys would need additional
 * normalization to interoperate with Solid's style binding cleanly.
 */
type CssMotionProperties = {
  [K in keyof csstype.PropertiesHyphen]?: Keyframes<Numeric | Stringish>
}

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

  // Common CSS with narrowed types (numeric-only). Hyphen-case keys to
  // match Solid's style convention. `opacity` is spelled the same way
  // in both camel and hyphen casing; `z-index` is the hyphen form.
  opacity?: Keyframes<Numeric>
  "z-index"?: Keyframes<Numeric>

  // Per-target transition override (Q3 sub-3)
  transition?: Transition
} & Omit<CssMotionProperties, "opacity" | "z-index" | "transition"> & {
    // CSS custom properties (e.g. `--my-color: "red"`). The csstype map
    // doesn't include these — they're free-form per design — so we add
    // a template-literal index signature scoped to the `--` prefix to
    // keep autocomplete usable (the OLD `[key: string]: ...` swallowed
    // EVERY string key, defeating discoverability).
    [key: `--${string}`]: Keyframes<Numeric | Stringish> | undefined
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
  /**
   * Root element to scope the {@link IntersectionObserver} to. Defaults to
   * the viewport. For reactivity, wrap the whole options object in an
   * accessor — e.g. `createInView(el, () => ({ root: rootEl() }))` or
   * `useMotion(() => ({ inViewOptions: { root: rootEl() } }))`. Plain
   * field-level accessors were dropped in 0.2.0.
   */
  root?: Element | null
}

// ---------------------------------------------------------------------------
// Drag options
// ---------------------------------------------------------------------------

/**
 * Drag bounds (Q8). Two shapes:
 *
 * - **Numeric** (`{ top, left, right, bottom }`): absolute MV-value bounds.
 *   Missing keys are unbounded on that side.
 * - **HTMLElement**: container the dragged element must stay inside. Bounds
 *   are computed at drag-start from the container's bounding rect.
 *
 * For a reactive container, wrap the surrounding `MotionOptions` in an
 * accessor — e.g. `useMotion(() => ({ drag: true, dragConstraints: containerEl() }))`.
 * Per-field accessors (`() => HTMLElement | null`) were dropped in 0.2.0.
 */
export type DragConstraints =
  | { top?: number; left?: number; right?: number; bottom?: number }
  | HTMLElement

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
  /**
   * Whether drag listens for its OWN pointerdown events on the element.
   * Defaults to `true`.
   *
   * Set to `false` when drag should only be started externally via a
   * `dragControls.start(event)` call from a different element (typically
   * a "drag handle"). The element itself remains non-draggable from
   * direct pointer interaction — useful for drawers, sheets, and other
   * surfaces where the body must stay scrollable and only a dedicated
   * affordance should commit to a drag.
   *
   * Mirrors motion-react's `dragListener` prop.
   */
  dragListener?: boolean
}

// ---------------------------------------------------------------------------
// Reorder options. The primitive `createReorder` accepts `ReorderOptions` for
// group-level configuration (axis, cancel-on-external-reorder). Per-item
// drag-handle composition (`dragListener`, `dragControls`) is configured
// directly on each item's MotionOptions — those fields already live on
// `DragOptions` and don't need a separate type. See
// docs/plans/0.2.0-reorder.md and ADR 0008.
// ---------------------------------------------------------------------------

export type ReorderOptions = {
  /**
   * Axis along which items can be dragged AND along which center-cross
   * detection fires reorders. Mirrors `drag: "x" | "y"` semantics —
   * the perpendicular axis is locked.
   *
   * Default: `"y"`.
   */
  axis?: "x" | "y"
  /**
   * Cancel an in-progress drag when `values` is mutated from outside the
   * primitive (e.g. a remove button, server push, or programmatic sort).
   * When `false` (default), the primitive re-measures and continues unless
   * the dragged item itself disappears from the array.
   *
   * Detection is via reference-identity check against the primitive's
   * own writes — any `setValues` call from outside the primitive (where
   * the resulting array is not the one the primitive just produced
   * itself) is treated as external.
   *
   * Default: `false`.
   */
  cancelOnExternalReorder?: boolean
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

  // Layout lifecycle (0.2.0)
  /** Fires when a layout animation starts on this element. */
  onLayoutAnimationStart?: () => void
  /** Fires when a layout animation completes (or is cancelled). */
  onLayoutAnimationComplete?: () => void
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

    // ---- Layout animations (0.2.0) ----

    /**
     * Auto-animate when a Solid render changes the element's measured
     * bounding rect (FLIP). Boolean shorthand for `true` animates both
     * position and size. Strings narrow the animation:
     *
     * - `"position"` — translate only; size changes are instant.
     * - `"size"` — scale only; position changes are instant.
     * - `"preserve-aspect"` — translate + uniform scale; maintains the
     *   rect's aspect ratio across the FLIP. The uniform scale is
     *   `Math.min(inverseScaleX, inverseScaleY)` — the element starts
     *   tucked within its source footprint, then grows or shifts to
     *   fill the target.
     */
    layout?: boolean | "position" | "size" | "preserve-aspect"

    /**
     * Shared-element identity. Two motion elements with the same
     * `layoutId` (in the same `<LayoutGroup>` scope) match across
     * mount/unmount; the entering element FLIPs from the donor's last
     * position. Runs in parallel with the donor's `exit` animation
     * when both are active under `<Presence>`.
     */
    layoutId?: string

    /**
     * Reactive trigger for layout re-measurement. Use when the cause
     * of the layout change isn't visible to the automatic triggers
     * (`ResizeObserver(self)`, `MutationObserver` on the immediate
     * parent's `style` / `class` / `childList`). Accessor form only —
     * a static value would never change, so a static dependency is
     * silently broken; the type forces the function form to surface
     * the reactivity contract.
     *
     * @example
     * <motion.div layout layoutDependency={() => items().length} />
     */
    layoutDependency?: Accessor<unknown>

    /**
     * Declare THIS element as a scrollable container for the purposes
     * of descendants' layout animations. Descendants compensate their
     * measured rects for this element's `scrollLeft` / `scrollTop`, so
     * user scrolling doesn't pollute layout deltas. The scroll-ancestors
     * chain RESETS at each `layout`/`layoutRoot` push — outer scrolls
     * above a new projection parent already cancel for descendants.
     */
    layoutScroll?: boolean

    /**
     * Declare THIS element as the projection root for descendants'
     * layout animations, overriding the nearest `layout` ancestor.
     * Use for fixed-positioned or absolute elements whose visual
     * position differs from their layout-flow position.
     */
    layoutRoot?: boolean

    /**
     * Parent-relative origin point for the layout animation. Each
     * component in 0..1. Default `{ x: 0, y: 0 }` (top-left, standard
     * FLIP). `{ x: 0.5, y: 0.5 }` pivots the layout animation from the
     * projection parent's center; `{ x: 1, y: 1 }` from the
     * bottom-right.
     */
    layoutAnchor?: { x: number; y: number }

    /**
     * Transition override specifically for layout animations.
     * Resolution chain: `layoutTransition` (most specific) →
     * `transition` (on this element) → `<MotionConfig>.transition`
     * (least specific). When reduced-motion is active, the existing
     * `mergeTransition` helper applies a final `{ duration: 0 }`
     * override; the FLIP runs in 0ms and lifecycle callbacks fire
     * normally. Applies to both `layout`-driven FLIPs and
     * `layoutId`-driven shared transitions.
     */
    layoutTransition?: Transition
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

// ---------------------------------------------------------------------------
// MotionStyle — the `style` prop shape accepted by useMotion + motion.X.
//
// Extends `JSX.CSSProperties` with two additions:
//
//   1. Motion's transform-shortcut keys (`x`, `y`, `scale`, `rotate`, ...).
//      These aren't valid CSS property names — motion composes them into
//      the `transform` CSS property at runtime via the registry-writer.
//
//   2. MotionValue variants of every value. `style={{ opacity: opacityMV,
//      scale: scaleMV }}` typechecks because every key (CSS or transform
//      shortcut) accepts either its native value type OR a MotionValue.
//
// The runtime contract lives in useMotion's `captureStyleEntries`:
// MotionValues land in the registry and the writer composes them on
// every change; static transform shortcuts seed transient registry
// entries; plain CSS keys pass through to Solid's style binding.
// ---------------------------------------------------------------------------

/**
 * Motion's transform-shortcut keys and their value types. Each key may be
 * a value OR a `MotionValue` holding that value.
 *
 * Value units (when expressed as a `number`):
 *   - `x` / `y` / `z` / `transformPerspective` → px
 *   - `scale*` → dimensionless multiplier
 *   - `rotate*` / `skew*` → deg
 *
 * Strings with explicit units pass through verbatim (e.g.
 * `x: "50%"`, `rotate: "0.5turn"`).
 *
 * Variance note: motion's `MotionValue<T>` is invariant in `T` (it has both
 * `get(): T` and `set(v: T)`), which means a user's `MotionValue<number>`
 * cannot widen to `MotionValue<number | string>`. We use `MotionValue<any>`
 * across the shortcut value types so a literal `createMotionValue(1)` is
 * assignable as `x` / `y` / etc. without forcing the caller to type the MV
 * with the full union. Type-safety on the value side is mostly recovered by
 * the runtime: `formatProperty` and `transformFunctionFor` handle the
 * number/string distinction.
 */
// biome-ignore lint/suspicious/noExplicitAny: see variance note above.
type AnyMotionValue = MotionValue<any>

export type MotionTransformShortcuts = {
  x?: number | string | AnyMotionValue
  y?: number | string | AnyMotionValue
  z?: number | string | AnyMotionValue
  scale?: number | string | AnyMotionValue
  scaleX?: number | string | AnyMotionValue
  scaleY?: number | string | AnyMotionValue
  scaleZ?: number | string | AnyMotionValue
  rotate?: number | string | AnyMotionValue
  rotateX?: number | string | AnyMotionValue
  rotateY?: number | string | AnyMotionValue
  rotateZ?: number | string | AnyMotionValue
  skew?: number | string | AnyMotionValue
  skewX?: number | string | AnyMotionValue
  skewY?: number | string | AnyMotionValue
  transformPerspective?: number | string | AnyMotionValue
}

/**
 * Widen each value of `T` to also accept any `MotionValue`. Pragmatic shape:
 * motion's `MotionValue<T>` is invariant in T, so a strict per-key
 * `MotionValue<NonNullable<T[K]>>` would reject e.g. `MotionValue<number>` for
 * a `width: string | number` key. `MotionValue<any>` is the necessary
 * escape hatch — the runtime always normalizes via `mv.get()` and
 * `formatProperty`.
 */
type WithMotionValues<T> = {
  [K in keyof T]?: T[K] | AnyMotionValue
}

/**
 * The `style` prop shape for motion-aware elements: every native CSS
 * property (with values optionally widened to a `MotionValue`), plus motion's
 * transform-shortcut keys (with the same widening).
 *
 * Some CSS individual-transform properties (`scale`, `rotate`) collide with
 * motion shortcut keys of the same name. We strip them from the CSS side
 * before intersecting — motion's semantics win, the legacy CSS individual-
 * transform path is a corner case users almost never reach for.
 *
 * @example
 * const scale = createMotionValue(1)
 * const m = useMotion({})
 * <div {...m({ style: { scale, opacity: 0.5, color: "red" } })} />
 */
export type MotionStyle = MotionTransformShortcuts &
  WithMotionValues<Omit<JSX.CSSProperties, keyof MotionTransformShortcuts>>

// Override `ref` + `style` from `JSX.HTMLAttributes` rather than intersecting
// (the latter would produce a `string | MotionStyle` mess for `style` because
// the base allows a raw CSS string and TypeScript can't narrow the union
// through the consumer code paths in useMotion).
export type ElementProps = Omit<JSX.HTMLAttributes<MotionElement>, "ref" | "style"> & {
  ref?: ((el: MotionElement) => void) | MotionElement | undefined
  style?: MotionStyle
}

export type MotionMergedProps<P extends ElementProps> = Omit<P, "ref" | "style"> & {
  // Output style is the INTERSECTION of MotionStyle and JSX.CSSProperties.
  // This is the only shape that works in both directions:
  //
  //   • Spread onto a raw JSX element: `<div {...m({})} />` — element's
  //     `style` expects `string | CSSProperties | undefined`. Intersection's
  //     scale/rotate collapse to `number | string` (MV variants drop out
  //     against the CSS Scale/Rotation types), assignable to CSSProperties.
  //
  //   • Chained back as input: `fade(slide({ class: "card" }))` — outer
  //     useMotion's `m()` expects `ElementProps` with `style: MotionStyle`.
  //     The intersection is also assignable to MotionStyle (narrower).
  //
  // Runtime emits MV-stripped values via `stripStyleEntriesOwnedByRegistry`,
  // so the actually-rendered prop carries only the intersection-narrow
  // values — type and runtime agree at this point.
  style: MotionStyle & JSX.CSSProperties
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
  drag?: Accessor<VariantLabels | undefined>
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
 * - `unregister(el)` — Presence (or the hook's `exit()`) prunes after exit.
 *   createMotion deliberately omits self-unregister; Solid disposes the
 *   child owner well before transition-group's onExit runs.
 * - `beforeUnmount(el)` — Presence (or the hook's `exit()`) dispatches to the
 *   registered `runExit`. Returns a resolved promise if no `runExit` is
 *   registered, so non-exit children pass through cleanly.
 * - `registerEnter` / `beforeMount` — symmetric to the exit pair. createMotion
 *   defers its first-mount animate when it's inside a real Presence (the
 *   no-op default has no `registerEnter`) because the element may be off-DOM
 *   at the moment the gesture-state-machine first iterates (e.g., the new
 *   child during a `mode: "wait"` swap is created BEFORE the old child's
 *   exit completes). Running motion's `animate()` on a disconnected element
 *   completes off-DOM and the final `commitStyles` silently no-ops, leaving
 *   the element painted at its `initial` target when it finally enters the
 *   DOM. Presence's `onEnter` (switch) / `onChange.added` (list) calls
 *   `beforeMount(el)` once the element is actually connected; the child's
 *   registered `runEnter` flips its readiness signal and the state machine
 *   dispatches the first animate against a live element.
 * - `initial` — when an enclosing `<Presence initial={false}>` (or the hook
 *   with `initial: false`) is active, descendants suppress their first-mount
 *   animation. Accessor-shaped so the implementation can flip post-mount.
 */
export type PresenceContextValue = {
  register: (el: MotionElement, runExit: () => Promise<void>) => void
  unregister: (el: MotionElement) => void
  beforeUnmount: (el: MotionElement) => Promise<void>
  registerEnter?: (el: MotionElement, runEnter: () => void) => void
  beforeMount?: (el: MotionElement) => void
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

// ---------------------------------------------------------------------------
// Layout animations (0.2.0)
// ---------------------------------------------------------------------------

/**
 * An entry deposited in the layout coordinator by a donor `layoutId`
 * element at owner-disposal time (synchronous with the `<Show>` / `<For>`
 * flip — BEFORE any exit animation runs). The consumer reads it during
 * its mount setup to derive its FLIP "First" rect. See ADR 0007 and
 * Plan §6.
 */
export type LayoutEntry = {
  /**
   * Donor's DOM element. The consumer checks `el.isConnected` to decide
   * whether to prefer a live `getBoundingClientRect()` (Presence
   * keep-alive case — donor still in DOM during exit) over the stored
   * {@link rect}.
   */
  el: Element
  /** Donor's bounding rect captured synchronously at owner disposal — pre-exit. */
  rect: DOMRect
  /** Donor's projection parent's bounding rect at donation time. */
  projectionParentRect: DOMRect
}

/**
 * Per-`<LayoutGroup>` coordinator brokering `layoutId` handoff between
 * donor (unmounting) and consumer (mounting) motion elements. A
 * module-level singleton serves as the implicit root coordinator for
 * `layoutId` elements not wrapped in an explicit `<LayoutGroup>`. The
 * runtime implementation lives in `layout-coordinator.ts`.
 */
export type LayoutCoordinator = {
  /**
   * Deposit a donor's entry for `layoutId`. Schedules an idempotent
   * per-coordinator RAF cleanup on first donation so unclaimed entries
   * expire by the next paint; cross-paint handoffs are expected to use
   * `<Presence>` to keep the donor's DOM element alive.
   */
  donate: (layoutId: string, entry: LayoutEntry) => void
  /**
   * Atomically retrieve and remove the entry for `layoutId`, returning
   * `null` if no match exists.
   */
  consume: (layoutId: string) => LayoutEntry | null
  /**
   * Register a currently-mounted layout-active element under `layoutId`.
   * Called by `createMotion` at mount. The live registry is queried by
   * `findLive` to handle the Presence/concurrent-mount case where a
   * new consumer mounts BEFORE the old donor's `onCleanup` fires.
   */
  register: (layoutId: string, el: Element) => void
  /**
   * Remove a previously-registered live element. Called at owner
   * cleanup (before `donate`).
   */
  unregister: (layoutId: string, el: Element) => void
  /**
   * Find any other live element with this `layoutId` excluding `self`.
   * Returns the first such element, or null. The consumer reads
   * `getBoundingClientRect()` on the returned element to derive its
   * starting position — the most accurate source when the previous
   * holder of the id is still in the DOM (Presence keep-alive, or
   * concurrent mount/unmount via `<Show>`).
   */
  findLive: (layoutId: string, self: Element) => Element | null
}

/**
 * Props for `<LayoutGroup>`. Fragment-only component (no DOM wrapper).
 * See Plan §3.3 and Q15 of the design grill.
 */
export type LayoutGroupProps = {
  /**
   * Reactive trigger for re-measurement of all `layout` descendants.
   * When this accessor's value changes, the group's broadcast counter
   * bumps and every descendant `layout` element schedules a measurement
   * pass. Use when an ancestor's class/style change drives the layout
   * shift and individual descendants can't see it via the automatic
   * triggers.
   *
   * Accessor form only — same rationale as `MotionOptions.layoutDependency`.
   */
  dependency?: Accessor<unknown>
  children: JSX.Element
}

/**
 * Context value carrying projection ancestry for layout animations.
 * Pushed by `<motion.X layout>`, `<motion.X layoutRoot>`, and
 * `<motion.X layoutScroll>` via `m.Provider` (auto-wrapped by the
 * proxy, opt-in for `useMotion` direct-use). See ADR 0007.
 */
export type ProjectionContextValue = {
  /**
   * The element to measure against for projection-parent-local
   * coordinates. Defaults to `document.documentElement` (top-level
   * projection parent — gives scroll-stable document-relative
   * coordinates without a separate scroll-compensation pass).
   */
  parentEl: Accessor<Element>
  /**
   * `layoutScroll` ancestors that are BETWEEN the consuming element
   * and its projection parent (inclusive of projection parent if it's
   * itself `layoutScroll`). The chain RESETS at each new projection
   * parent pushed by `layout`/`layoutRoot` — outer scrolls above the
   * new reference frame already cancel out for descendants and would
   * over-compensate if carried through.
   */
  scrollAncestors: Accessor<Element[]>
}

/**
 * Context value provided by `<LayoutGroup>`. Carries the per-group
 * coordinator for `layoutId` handoff and a broadcast counter that
 * descendant `layout` elements subscribe to for re-measurement. See
 * Plan §3.3.
 */
export type LayoutGroupContextValue = {
  /** Per-group coordinator for `layoutId` donate/consume. */
  coordinator: LayoutCoordinator
  /**
   * Monotonically-increasing counter. Bumps on every `dependency`
   * change (via the LayoutGroup's internal `createComputed`).
   * Descendants subscribe via `createEffect(() => { broadcast();
   * scheduleMeasurement() })`. The implicit-root default value
   * is `() => 0` (constant — never re-fires).
   */
  broadcast: Accessor<number>
}
