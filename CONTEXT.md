# Glossary

Canonical terms for this codebase. Implementation lives in code; this file
lives to keep the language tight.

## Library identity

- **the library / motion / solidjs-motion** — this package. Shipped under
  three identifiers (npm `solidjs-motion`, JSR `@solidjs-motion/motion`,
  GitHub `solidjs-motion/motion`). Internal workspace path
  `packages/motion/`.
- **upstream motion** — the framework-agnostic `motion` npm package we
  wrap. Always written out as "upstream motion" or "the `motion` npm
  package" to avoid collision with the library's own name.
- **motion-dom** — the underlying DOM-targeted package we depend on
  directly for gesture/drag/animation mechanics (ADR 0001).

## Motion mechanics

- **MotionValueAccessor\<T\>** — the callable hybrid that backs every
  animatable value (`MotionValue<T> & (() => T)`). See
  `packages/motion/src/types.ts`.
- **value registry** — per-element `Map<string, MotionValue>` plus a
  swappable writer closure. The single writer for `el.style.transform`.
  See ADR 0005.
- **gesture state machine** — the seven-flag `createStore` that resolves
  active gesture priority per element. See ADR 0002.
- **Presence / PresenceContext** — exit-animation coordinator with the
  inverted "child knows how to animate itself out" shape. See ADR 0003.
- **motion proxy / `motion.X` / `motion.create(Component)`** — the
  JSX-level wrappers built on `useMotion`. See ADR 0004.

## Layout animations (0.2.0 work-in-progress)

- **layout (prop)** — opt-in on a motion element to auto-animate when a
  Solid render changes the element's measured bounding rect. FLIP
  (First-Last-Invert-Play) is the implementation primitive.
- **layoutId (prop)** — string that pairs two motion elements across
  mount/unmount so a transition animates between them (shared-element
  transition).
- **LayoutGroup** — scope that synchronizes layout measurements across
  multiple sibling elements; without it, parent-driven reorder cascades
  measure children in the wrong order.
- **layoutScroll (prop)** — declares an ancestor as a scrollable container
  whose `scrollLeft`/`scrollTop` must be accounted for during measurement.
- **layoutRoot (prop)** — declares an ancestor as the reference frame for
  layout animations inside that subtree, so descendants animate relative
  to that root rather than the viewport (use case: fixed-position panels).
- **layoutAnchor (prop)** — `{ x: 0..1, y: 0..1 }` parent-relative origin
  point. Default behaviour is viewport/page-relative; this overrides the
  origin so the layout animation pivots from a point inside the parent.
- **FLIP** — measure First rect, render the layout change, measure Last
  rect, apply an Inverting transform that visually keeps the element at
  the First position, then Play the animation by tweening the inverse
  back to identity.
- **layout writer** — the contribution this feature makes to the value
  registry's transform writer. Implemented as a SECOND LAYER in the
  existing registry: the registry gains a typed `layoutLayer` sub-record
  (`x`/`y`/`scaleX`/`scaleY`, each holding a `MotionValue<number>`).
  When present, the writer folds each axis into the corresponding
  user-facing key's effective value (`effectiveX = x + layoutLayer.x`,
  `effectiveScaleX = scaleX * layoutLayer.scaleX`) BEFORE the existing
  `TRANSFORM_ORDER` walk emits the CSS transform functions. No new
  emission shape, no new string keys in the registry map. One
  contributor per layer; no multi-source contention because layout
  itself only ever has one active source per element at a time. The
  axis names `_layoutX`/`_layoutY`/`_layoutScaleX`/`_layoutScaleY` are
  documentary only — they appear in ADR text and code comments, not as
  live string keys. See ADR 0006.
- **measurement trigger** — the signal that tells `createMotion` "the
  layout for this element may have changed; schedule a re-measure on the
  next `frame.read` pass." Solid does not propagate top-down on parent
  re-renders the way React does, so trigger sources have to be wired
  explicitly. We combine: `ResizeObserver(self)`, a single
  `MutationObserver` on the immediate parent with
  `{ childList: true, attributes: true, attributeFilter: ["style", "class"] }`
  (catches sibling reorder/insert/delete AND parent restyles like
  `alignItems` flips that reposition descendants without resizing them),
  `<LayoutGroup dependency={signal}>` broadcast through context, and the
  per-element `layoutDependency` prop. False-positive measurements
  (parent attribute mutated but our rect is unchanged) de-dupe
  cheaply via `First === Last` — no animation fires; the measurement
  work was a single `getBoundingClientRect`. The deep-ancestor-restyle
  case (grandparent's class change shifts our position via cascade
  without mutating our immediate parent's attributes) has no automatic
  detection and requires the user to wrap that ancestor in
  `<LayoutGroup>` with a `dependency` — documented gap.
- **layout dependency** — the signal whose change indicates "re-measure
  is appropriate." Plumbed via `LayoutGroup`'s `dependency` prop
  (broadcasts to all `layout` descendants through context) or the motion
  element's own `layoutDependency` prop (per-element).
- **`createAttributeSignal(ref, attrs?)`** — Solid-bridge helper for
  cases where the source of an ancestor change isn't a Solid signal
  (third-party DOM manipulation, native attributes like `<dialog open>`,
  etc.). Returns an `Accessor<number>` that increments when the watched
  attributes mutate. Compose with `LayoutGroup.dependency` or
  `layoutDependency` to bridge non-Solid sources into the trigger model.
- **layout coordinator** — per-`LayoutGroup` registry (`Map<layoutId,
  LayoutEntry>`) that brokers cross-element handoff for `layoutId`
  matches. Donors write their final rect at `onCleanup`; consumers read
  during mount setup. There is an **implicit root coordinator** that
  contains all `layoutId` elements not wrapped in an explicit
  `<LayoutGroup>` — matching motion-react's default.
- **donate / consume** — the layout coordinator's API. Donor's
  `onCleanup` calls `donate(layoutId, entry)`; consumer's mount setup
  calls `consume(layoutId)` which returns + clears the matched entry.
- **entry lifetime** — registry entries persist from their `donate`
  call until either (a) consumed by a matched mount, or (b) the next
  `requestAnimationFrame` callback fires (idempotent RAF cleanup
  scheduled by the first `donate` of each frame). This window covers any
  same-paint handoff including multi-microtask reactive cascades, while
  bounding leaks across paint boundaries. Cross-paint handoffs (route
  transitions) are expected to use `<Presence>` to keep the donor alive
  in the DOM.
- **layoutId × exit parallel semantics** — when an element with
  `layoutId` is exiting under `<Presence>` AND a matched element mounts
  elsewhere, **both animations run in parallel**, matching motion-react.
  The exiting element completes its `exit` target (e.g., fading);
  meanwhile the entering element FLIPs from the donor's current position
  to its natural position. The two animations are independent — no
  cross-cancellation, no exit suppression.
- **projection parent** — the rect every `layout` element measures
  against. Provided via Solid context by the nearest ancestor that's
  itself a `layout` or `layoutRoot` element. For elements with no such
  ancestor, the implicit projection parent is
  `document.documentElement` — chosen so top-level layout elements get
  scroll-stable document-relative coordinates without needing a
  separate scroll-compensation pass at the root. `<LayoutGroup>` is
  fragment-only and does NOT anchor projection; projection ancestry
  and `layoutId` scoping are orthogonal.
- **projection-parent-local coordinates** — `(element.rect.x -
  parent.rect.x, element.rect.y - parent.rect.y)`. The First/Last
  measurements stored by every `layout` element. Animating the delta
  in local coords means each element's invert reflects only its
  movement WITHIN its projection parent — ancestor FLIPping doesn't
  leak into descendants' computed deltas. Avoids motion-react's
  projection-node-tree machinery for the nested case.

### Public API surface (0.2.0)

The user-visible shape, locked during the grill session.

**On `MotionOptions`** (added on top of the existing animate/exit/drag/gesture surface):

```ts
type MotionOptions = {
  // ... existing ...
  layout?: boolean | "position" | "size" | "preserve-aspect"
  layoutId?: string
  layoutDependency?: Accessor<unknown>
  layoutScroll?: boolean
  layoutRoot?: boolean
  layoutAnchor?: { x: number; y: number }   // default { x: 0, y: 0 }
  layoutTransition?: Transition
  onLayoutAnimationStart?: () => void
  onLayoutAnimationComplete?: () => void
}
```

**On `<LayoutGroup>`:**

```ts
type LayoutGroupProps = {
  dependency?: Accessor<unknown>
  children: JSX.Element
}
```

LayoutGroup is fragment-only (no DOM wrapper). `id` for cross-group
namespacing is deferred to a later release.

**Transition resolution for layout animations:**

For a `layout` or `layoutId` animation, the effective Transition is
resolved by precedence (most-specific wins):

1. `layoutTransition` on the motion element.
2. `transition` on the motion element.
3. `transition` on the enclosing `<MotionConfig>`.

**Reactivity convention for layout deps:**

`layoutDependency` (per-element) and `dependency` (on LayoutGroup) are
typed as `Accessor<unknown>` — there is no static-value form, and
this is the only `MotionOptions` property with that constraint.
Other layout props (`layoutAnchor`, `layoutTransition`) follow the
standard `MotionOptions` pattern of static typing, with reactivity
coming from the outer `useMotion(() => opts)` function-form
signature.

Reason `layoutDependency` is the exception: a dependency that doesn't
change has no semantics. Without the `Accessor` constraint, a user
could write `<motion.div layoutDependency={5} />` — type-checks, runs
silently, never fires a re-measure. With the `Accessor` constraint,
that line fails type-check; the user is forced to either write
`() => 5` (which still does nothing but is at least obviously
intentional) or `() => items().length` (the real reactive form).
`layoutAnchor: { x: 0.5, y: 0.5 }` has no equivalent footgun — a
fixed anchor is a meaningful value — so it stays static-typed.

```tsx
<motion.div layout layoutDependency={() => items().length} />
<LayoutGroup dependency={() => isOpen()}>
  …
</LayoutGroup>
```

**`layout` modes:**

- `true` — animate both position and size.
- `"position"` — animate only position; size changes are instant.
- `"size"` — animate only size; position changes are instant.
- `"preserve-aspect"` — animate position and uniform scale only; maintains
  the original aspect ratio across the FLIP (no anisotropic scaling).

**Helper:**

`createAttributeSignal(ref, attrs?): Accessor<number>` — Solid-bridge
for non-Solid-source ancestor changes. Composes with `layoutDependency`
or `LayoutGroup.dependency`.

## Reorder (0.2.0)

Reorder is a layout-feature consumer rather than a new layout primitive
— it builds on `layout` (for the sibling FLIP cascade) and `drag` (for
the active item's pointer-driven motion). It ships in the same 0.2.0
release alongside the layout primitives but lives in its own plan +
ADR; see [docs/plans/0.2.0-reorder.md](docs/plans/0.2.0-reorder.md) and
[docs/adr/0008-reorder-primitive-and-components.md](docs/adr/0008-reorder-primitive-and-components.md).

- **Reorder** — drag-driven list reordering. As the user drags an item
  along a configured axis, sibling items FLIP into the vacated slot via
  the layout primitive; the dragged item's own layout FLIP is suppressed
  for the duration of the drag. The controlled `values` array is
  updated live as the dragged item's center crosses each sibling's
  center — `onReorder` fires per swap.
- **`createReorder`** — the primitive hook. Takes a values source
  (either `Accessor<T[]>` from `createSignal` OR a `T[]` directly from
  `createStore` — `store.items` is a reactive proxy that isn't itself a
  function), an `onReorder` setter with shape `(next: T[]) => void`
  (both `Setter<T[]>` and `SetStoreFunction<T[]>` are structurally
  compatible), and optional reactive options. Returns
  `{ group, item, dragging }`: `group.ref` for the container element,
  `item(value, motionOptions?)` per-row factory returning the same
  `UseMotionResult` shape `useMotion` does, and `dragging()` accessor
  of the value being dragged (or `null`). Composes with explicit `<For>`
  (and with `<Presence exitMethod="keep-index">` when items need exit
  animations).
- **`<Reorder.Group>` / `<Reorder.Item>`** — JSX-level wrapper
  components around `createReorder`. Group defaults to `<ul>` and
  internally wraps children in `<LayoutGroup>` (scopes any `layoutId`
  matches inside the list); Item defaults to `<li>` and auto-applies
  `layout: true` + `drag: <axis>` so the user only specifies `value`
  and children. Both accept `as` for tag overriding. Children are a
  user-provided `<For>` (so empty states, `<Presence>` wrapping, and
  `Index`-vs-`For` choice all work normally).
- **value (Reorder.Item prop)** — the per-item identity passed by the
  user to bind a JSX node to an array slot. Same reference-identity
  rule that Solid's `<For>` uses. Duplicate values within the array
  produce undefined behavior; documented constraint.
- **center-cross detection** — the rule that fires `onReorder`. As the
  dragged item moves along the configured axis, when its center along
  the axis passes a sibling's center the two swap in `values`. Multiple
  crossings per pointermove frame are processed in order (so a fast
  drag past several items reorders correctly). No debounce / minimum-
  displacement threshold; sub-pixel jitter de-dupes naturally because
  the dragged item starts coincident with its own slot's center.
- **drag-suppressed layout** — the mechanism that prevents a dragged
  item's `layout` FLIP from firing during the drag. Without it, every
  reorder of `values` would cause the dragged item's controller to
  detect a slot change and animate to the new slot — fighting the
  pointer-driven `drag` transform that should own the item's visual
  position. The existing gesture-state-machine flag `whileDrag` is the
  gate; when true on a layout-active element, its `createLayoutController`
  skips the measurement/FLIP path for that element only. Sibling
  controllers are unaffected and FLIP normally.
- **drag-scroll** — a drag-gesture capability that lives in
  `createDrag`, so it's available to any `drag`-enabled motion element,
  not just Reorder. While a drag is active and the pointer enters the
  threshold zone near a scrollable container's leading/trailing edge,
  that container auto-scrolls along the drag axis so the drag can
  continue past the visible viewport; the dragged element's own
  translate is compensated each frame so it stays under the pointer.
  Container resolution auto-discovers the nearest scrollable ancestor
  along the drag axis (falling through to the document/window scroller),
  or takes an explicit `dragScrollContainer` override. On by default for
  a scrollable container; a no-op when there's no scroll range. Governed
  by `dragScroll` (enable), `dragScrollThreshold` (edge-zone px),
  `dragScrollSpeed` (max px/sec), and `dragScrollContainer` (override).
  `<Reorder.Group>` exposes `dragScroll` / `dragScrollThreshold` /
  `dragScrollSpeed` at the **group** level (a list-wide behaviour, not
  per item) and fans them down to every item's drag — the same way
  `axis` becomes each item's `drag`. It also passes its [[layoutScroll]]
  group element as the container explicitly, so the scrolled element is
  guaranteed to be the one descendant FLIPs compensate for; Reorder
  additionally folds the scroll delta into its [[center-cross detection]]
  so swaps stay correct while scrolling.
- **drag handle (Reorder)** — optional opt-in to drag initiation from
  a specific child node rather than the whole item. Composes with the
  existing `createDragControls` primitive: the user creates a
  `DragControls`, passes it on `<Reorder.Item dragControls={controls}
  dragListener={false}>`, and calls `controls.start(event)` from the
  handle's `onPointerDown`. Same shape as motion-react's
  `useDragControls`.
- **`createReorderKeyboard`** — deferred primitive for keyboard-driven
  reorder (Space-to-grab + arrow keys + Escape-to-cancel). Drag-only is
  v1's parity surface; keyboard support documented as a follow-up
  release item. Will be additive (no changes to `createReorder`'s
  signature when added).

### Public API surface (Reorder, 0.2.0)

**`createReorder` primitive:**

```ts
function createReorder<T>(
  values: Accessor<T[]>,
  setValues: Setter<T[]>,
  options?: ReorderOptions | Accessor<ReorderOptions>,
): {
  groupProps: ElementProps
  itemProps: (value: T, options?: ReorderItemOptions) => ElementProps
}

type ReorderOptions = {
  /** Drag + center-cross axis. Default: "y". */
  axis?: "x" | "y"
}

type ReorderItemOptions = {
  /**
   * When false, the item does NOT install a whole-item pointer
   * listener. Pair with `dragControls` to wire drag initiation to a
   * custom handle. Default: true.
   */
  dragListener?: boolean
  /**
   * Handle for explicit drag initiation. Composes with
   * `createDragControls()`. The handle's `onPointerDown` calls
   * `controls.start(event)` to start the drag.
   */
  dragControls?: DragControls
}
```

**`<Reorder.Group>` component:**

```ts
type ReorderGroupProps<T> = {
  values: Accessor<T[]>
  onReorder: Setter<T[]>
  /** "x" | "y". Default: "y". */
  axis?: "x" | "y"
  /** Container tag. Default: "ul". */
  as?: keyof JSX.IntrinsicElements
  children: JSX.Element
}
```

**`<Reorder.Item>` component:**

```ts
type ReorderItemProps<T> = MotionOptions & {
  value: T
  /** Item tag. Default: "li". */
  as?: keyof JSX.IntrinsicElements
  dragListener?: boolean
  dragControls?: DragControls
  children: JSX.Element
}
```

`<Reorder.Item>` extends `MotionOptions` so per-item `initial` /
`animate` / `exit` / `transition` / `dragTransition` / lifecycle hooks
all work the same way they do on a `<motion.li>`. `layout` and `drag`
are managed by the wrapper and shouldn't be overridden by the user.
