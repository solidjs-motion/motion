# Projection-parent-local coordinates for layout measurements

Layout animations FLIP each `layout` element from its previous bounding
rect to its new one. `getBoundingClientRect` is viewport-relative —
which makes nested `layout` elements over-correct. If a parent and child
both have `layout` and both shift, the child's measured viewport delta
includes the parent's shift. Naively applying the child's invert moves
the child past where it should be (the parent's invert has already
translated the child via its DOM parentage; adding the child's
world-coord invert double-counts).

Motion-react solves this via a **projection-node tree**: every `layout`
element is a node; nodes track their parent; the writer subtracts
ancestor projection deltas when computing a child's transform. The
machinery is one of the largest sub-systems in framer-motion.

We want a simpler answer that gets the math right for the nested case
without the bookkeeping.

The design space had two viable approaches (a third — measure in world
coords and accept the bug — is not viable). Approach 1 was the projection-
node-tree port. Approach 2 was to measure each element's rect in
**projection-parent-local coordinates** so the delta is intrinsically
local and ancestor movement doesn't leak into descendant inverts.

**Decision:** Approach 2. Every `layout` element measures its First and
Last rects relative to a *projection parent's* rect. The projection
parent is the nearest ancestor that's itself a `layout` element OR a
`layoutRoot` element, established via Solid context. For top-level
layout elements with no such ancestor, the projection parent is
`document.documentElement`, chosen so top-level measurements are
scroll-stable without needing a separate scroll-compensation pass.

## Load-bearing details

- **Projection parent established via Solid context.** Every
  `<motion.X layout>` and `<motion.X layoutRoot>` provides a
  `ProjectionContext` whose value is its element ref. Descendant
  `layout` elements consume that context to find their projection
  parent. Context propagates through non-motion components and arbitrary
  DOM depth naturally — no DOM traversal needed at measurement time.

- **Context push site: `m.Provider`, identically to `VariantContext`.**
  The `<motion.X>` proxy auto-wraps children in `m.Provider` (per
  ADR 0004), so the proxy path pushes both `VariantContext` and
  `ProjectionContext` automatically. The `useMotion` direct-use path
  is opt-in by the user — descendants must be wrapped in `<m.Provider>`
  to inherit projection ancestry (same convention as variant
  inheritance). A user who calls `useMotion({ layout: true })` without
  wrapping descendants in `<m.Provider>` will have descendant `layout`
  elements silently fall back to `document.documentElement` as their
  projection parent (correct top-level behaviour, wrong nested
  behaviour). In dev builds, `createMotion` emits a one-shot
  `console.warn` on first measurement when a layout-active descendant
  resolves its projection parent to anything other than this element,
  surfacing the missed-Provider footgun loudly the first time it
  matters. Trade-off rationale: matches the existing
  `VariantContext`/`m.Provider` opt-in convention so users learn the
  rule once; the proxy auto-wrap covers the common case; the dev
  warning catches the direct-use misconfiguration without enforcing a
  runtime rejection.

- **Local-coord math.** For an element with rect `E` and projection
  parent with rect `P`:

  ```
  local.x = E.x - P.x
  local.y = E.y - P.y
  ```

  First and Last are both stored in this form. Delta is just
  `Last - First` — already local. The element's invert is the negative
  of the delta. No tree-walk, no ancestor subtraction at write time.

- **`document.documentElement` as implicit top-level projection parent.**
  Its `getBoundingClientRect` returns a rect whose `top`/`left` are
  negative when the page is scrolled (the document is "above" the
  viewport). Subtracting it from a top-level element's rect yields
  document-relative coordinates — STABLE across page scroll. A user
  scrolling the page doesn't drift a top-level layout element's
  measured position.

  This is intentionally different from motion-react's choice (they use
  the viewport and compensate scroll explicitly via projection-node
  state). Document-relative bypasses the need for that compensation at
  the root.

- **`<LayoutGroup>` is fragment-only and does NOT anchor projection.**
  LayoutGroup provides context for `layoutId` namespacing and
  measurement broadcast (`dependency` prop), but has no DOM element of
  its own to measure against. Projection ancestry walks past it,
  finding the nearest DOM-bearing `layout`/`layoutRoot` ancestor.
  Projection ancestry and `layoutId` scoping are **orthogonal**.

- **`layoutScroll` adds compensation, not a new projection rule.**
  When a scroll container scrolls, descendants' viewport-relative
  rects shift even though no real layout change happened. To keep
  this out of FLIP deltas, descendants add the container's
  `scrollLeft`/`scrollTop` back into their local-coord math:

  ```
  local.x = E.x - P.x + scrollContainer.scrollLeft
  local.y = E.y - P.y + scrollContainer.scrollTop
  ```

  **The chain-membership rule is precise: only `layoutScroll`
  ancestors that are BETWEEN the element and its projection parent
  (inclusive of projection parent if it's itself `layoutScroll`)
  contribute compensation.** `layoutScroll` ancestors ABOVE the
  projection parent do not contribute — they shift both the element
  and the projection parent equally, so their effect cancels at the
  `E.x - P.x` step.

  Mechanically, this is enforced by the context push logic
  ([plan §7.2](../plans/0.2.0-layout-animations.md#72-who-pushes-context)):
  when an element pushes a NEW projection parent (`layout` or
  `layoutRoot`), the scroll-ancestors chain RESETS — outer
  `layoutScroll` ancestors drop off the chain at that point. Within
  a single projection-parent's subtree, `layoutScroll`-only elements
  extend the chain without changing the projection parent.

- **`layoutAnchor` adjusts the local-coord origin, not the projection
  parent.** The anchor `{ x, y }` (each in 0..1) shifts the local origin
  to a fraction of the projection parent's box:

  ```
  local.x = (E.x - P.x) - (P.width * anchor.x)
  local.y = (E.y - P.y) - (P.height * anchor.y)
  ```

  Default `{ x: 0, y: 0 }` keeps the top-left origin (standard FLIP).
  `{ x: 0.5, y: 0.5 }` pivots layout animations from the parent's
  center.

## Why not the projection-node tree

The tree has real benefits we're declining:

1. **Granular tracking of ancestor state.** Each node carries its
   "currently projected" delta so descendants can read it during the
   compile. With local-coord measurement, we don't need to know ancestor
   deltas at write time — they don't enter the math.

2. **Easier composition of complex interpolation features.** Things like
   "interpolate position AND clip-path during a `layoutId` transition"
   are simpler when every node has full transform state available.

3. **A clean place to hang projection-aware features** like
   shared-element transitions across non-motion DOM hops (e.g., portals).

The cost of the tree:

1. **Per-frame bookkeeping.** Every node updates its projected state on
   each measurement pass; descendants read it.

2. **Dirty propagation.** When an ancestor's projection changes,
   descendants need to re-derive. The dirty-marking and traversal logic
   is a real implementation surface.

3. **Significant code volume.** framer-motion's projection module is
   thousands of lines.

For 0.2.0 we want layout animations to land cleanly without the entire
projection-node-tree subsystem. Approach 2's local-coord measurement
handles every nested case in our scope without that machinery.

## Known limitations of Approach 2

- **Complex shared-element transitions across multiple layout
  ancestors.** If element A inside parent X has `layoutId="x"` and
  matches element B inside parent Y, and the user is animating BOTH X
  and Y simultaneously, B's FLIP needs to interpolate A's projected
  position (which depends on X's transform) against B's intended
  position (under Y's transform). With projection-node tree this is
  natural; with local coords we'd compose by reading A's and B's
  ancestor chains. The math is doable but the implementation involves
  walking the ancestor projection-parent chain at handoff time
  — essentially a partial tree-walk for this one case.

- **Portal-style `layoutId` matches that cross non-motion DOM hops.** A
  layoutId match where the donor and consumer don't share a projection
  ancestor relies on the coordinator's stored rect rather than ancestor
  composition. Works correctly because the donor's rect is captured at
  unmount time in absolute document coords.

Both limitations are acceptable for the 0.2.0 scope. Revisit if
real-world use produces concrete pain.

## When to revisit

If we ship a feature that needs ancestor projection state at write time
(e.g., a "magnetic" effect that snaps an element toward a parent's
center using the parent's animated position, not its measured rect),
the local-coord measurement won't have that information available
without a per-element ancestor walk. At that point, promoting to a
proper projection-node tree may be cheaper than threading ad-hoc
ancestor-walks through the writer.

Until then, projection-parent-local coordinates are correct AND
substantially simpler than the tree.
