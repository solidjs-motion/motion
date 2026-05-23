# Layout writes to reserved registry keys (no per-key layered contributors)

ADR 0005 established the per-element value registry as the single writer
for `el.style.transform`: every motion path that wants to contribute to
the transform string registers a MotionValue under a key, and one
swappable writer closure compiles the keys into a transform string each
frame. Two writers racing on `transform` corrupt each other's output.

Layout animations need to contribute too. FLIP applies a translate
(always) and a scale (when size changed) that invert the measured delta
between the previous and current bounding rects, then animates that
inverting transform back to identity. The inverting transform IS a
transform contribution to the same DOM property the registry already
manages — it has to enter the same composition pipeline, NOT bypass it.

The design space had four options grilled during the 0.2.0 layout-animations
design session: (A) reserved keys in the existing one-MV-per-key registry,
(B) write to the CSS `translate`/`scale` individual transform properties
in parallel to `transform`, (C) have layout drive the user-facing
`x`/`y`/`scale` keys directly, (D) generalize the registry to N
contributors per key with explicit composition rules.

**Decision:** Option A. Layout reserves four keys in the existing
registry — `_layoutX`, `_layoutY`, `_layoutScaleX`, `_layoutScaleY`. The
writer's compile logic concatenates them with the user-facing keys in a
fixed order, additive for translate and multiplicative for scale. The
registry's one-MV-per-key contract is preserved.

## Load-bearing details

- **Reserved-key naming.** Leading underscore marks them as internal.
  Users cannot pass `_layoutX` through animate/style/etc.; the writer
  rejects it. The names exist solely as compile-time integration points
  between the layout module and the registry's writer.

- **Composition order in the compiled transform string.** Layout
  translates apply LAST (outermost in CSS terms), matching motion-react's
  behaviour where rotation and scale happen first and layout-translate
  positions the visually-completed element. Concrete string shape
  (subject to empirical match against motion-react during implementation):

  ```
  translate(_layoutX, _layoutY) translate(x, y) rotate(...) scale(scaleX, scaleY) scale(_layoutScaleX, _layoutScaleY)
  ```

  The exact order is locked at the writer's compile site; users never see
  it. The commitment is "fixed, intentional, and matches motion-react where
  measurable."

- **Composition is layered, not multi-contributor.** Layout writes ONE MV
  per reserved key; the writer reads ONE MV per reserved key. No
  per-key aggregation list, no composition-rule table. The math is
  hardcoded in the compile: translates add (`x + _layoutX`), scales
  multiply (`scaleX * _layoutScaleX`).

- **One layout contributor per element.** Across every layout feature
  (`layout`, `layoutId`, `LayoutGroup`, `layoutScroll`, `layoutRoot`,
  `layoutAnchor`), each element has at most one active layout source at
  any moment. Layout animations cancel and replace each other; they do
  not stack. The two-layer model (user + layout) is sufficient.

- **Drag still mirrors into `x` / `y`.** Per ADR 0005, drag is a special
  case where motion-dom's VisualElement owns the MV and the registry
  mirrors. Drag continues to write to the user-facing `x`/`y` keys. It
  does NOT interact with the layout reserved keys; the writer composes
  them independently.

## Why not Option D (N contributors per key with composition rules)

D is the principled answer for a hypothetical world where transform keys
have many independent contributors. We don't live in that world. Today's
contributors to transform keys are: `animate`, `style={{ x: mv }}`,
static style shortcuts, `initial`, drag (via mirror), and now layout.
All of these collapse to ONE active MV per key per element except for
layout, which adds a second layer (the inverting transform).

D's generality buys us:

1. A parametrized composition rule (we could change the order without
   editing the writer's source).
2. Easy addition of a third layer without further reserved-key churn.
3. A cleaner mental model for developers reading the registry.

The cost:

1. Data shape change: `Map<string, MotionValue>` becomes
   `Map<string, Contributor[]>`. Every read/write iterates a list.
2. Per-frame overhead: writer aggregates contributors per key each
   compile. Cheap per key but real.
3. Bigger debug surface: "which contributors are active for this key?"
   replaces "what's the value at this key?"

No third layer is on the roadmap. Pinch-zoom would follow drag's pattern
(motion-dom-owned MV mirrored into the user-facing key). Speculative
features like parallax overlays compose via the existing user MV path.

**Migration path A → D is bounded.** Public surface (animate keys,
style keys) is unchanged regardless of underlying storage. Only the
registry's storage shape and the writer's compile logic change. If a
real third-layer use case emerges, the refactor is contained to
`createMotion`'s registry and the writer module. So A doesn't paint us
into a corner; it just doesn't pay D's complexity tax up front.

## Why not Option B (CSS `translate`/`scale` individual properties)

B sidesteps the writer entirely: layout writes its own CSS properties
(`translate: …`, `scale: …`) which the browser composes multiplicatively
with `transform: …`. Clean separation.

Two real problems:

1. **Browser support.** Individual transform properties are Safari 14.1+,
   Firefox 72+, Chrome 104+. Within the 0.2.0 release window this is
   fine for evergreen users but a real compat ask we'd have to document.

2. **Animation path divergence.** motion-dom's animation machinery
   targets `transform`. We'd be inventing a parallel animation path for
   the individual properties, with its own keyframe resolver, WAAPI
   fallback story, and `reduced-motion` handling. Significant code
   duplication.

A reuses the existing animation pipeline by routing layout writes
through motion-dom's `animate()` against the reserved-key MVs.

## Why not Option C (layout drives user-facing keys directly)

C has layout read the user's current `x`/`y`/`scale` values, compose the
inverting delta, and animate THE SAME keys toward the user's target.
Tempting because it needs no new registry surface.

It introduces an arbitration problem: at any moment, who's the "driver"
of `x`/`y` for this element — the user's `animate.x: 100`, drag, or
layout? Motion-react has explicit precedence rules for this; we'd need
the same. The complexity is real and user-visible: users get surprised
when `animate.x: 100` looks like it tweens to `100 + layoutDelta`. The
reserved-key approach keeps the user's target free of layout
interference.

## When to revisit

If we ship a feature beyond the layout family that needs to be a third
independent transform-key contributor — pinch-zoom-as-its-own-thing not
following drag's mirror pattern, a future "magnetic" UI affordance, etc.
— that's the moment to evaluate D. The reserved-key approach extends to
a third feature awkwardly (add `_pinchX`, `_pinchY` as another reserved
namespace, more compile-logic special cases), so when the awkwardness
becomes too much, refactor.

Until then, A is correct, not just incremental.
