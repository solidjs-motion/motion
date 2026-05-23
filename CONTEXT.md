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
  existing registry: layout reserves keys (`_layoutX`, `_layoutY`,
  `_layoutScaleX`, `_layoutScaleY`) that participate in the writer's
  compile alongside the user-facing keys (`x`, `y`, `scaleX`, `scaleY`).
  The writer composes them in a fixed order (additive for translate,
  multiplicative for scale). One contributor per layer; no multi-source
  contention because layout itself only ever has one active source per
  element at a time (see ADR for the analysis). Pending ADR 0006.
- **measurement trigger** — the signal that tells `createMotion` "the
  layout for this element may have changed; schedule a re-measure on the
  next `frame.read` pass." Solid does not propagate top-down on parent
  re-renders the way React does, so trigger sources have to be wired
  explicitly. We combine: style-write interception in our own writer
  pipeline, `ResizeObserver(self)`, `MutationObserver(parent, { childList })`,
  `<LayoutGroup dependency={signal}>` broadcast through context, and the
  per-element `layoutDependency` prop. The deep-ancestor-restyle case
  (grandparent's class change shifts our position without resizing us)
  has no automatic detection and requires the user to wrap that ancestor
  in `<LayoutGroup>` with a `dependency` — documented gap.
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
both typed as `Accessor<unknown>` — explicit-function-form only,
intentionally stricter than the audit's `Accessor<T> | T` pattern.
Users always pass a function:

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
