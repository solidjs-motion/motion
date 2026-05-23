# Changelog

All notable changes to `solidjs-motion` / `@solidjs-motion/motion` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

> Targeted for **0.2.0** — version files (`package.json`, `jsr.json`) will
> be bumped when this lands alongside the layout-animations work. See
> [docs/plans/0.2.0-api-audit.md](../../docs/plans/0.2.0-api-audit.md) for
> the design decisions behind this audit.

### Breaking

- **`ViewportOptions.root` is now `Element | null` instead of `() => Element | null`.**
  Reactivity moves up to the whole-options accessor. Migration:

  ```ts
  // before (0.1.x)
  createInView(el, { root: () => rootEl() })

  // after (0.2.0) — createInView direct
  createInView(el, () => ({ root: rootEl() }))

  // after (0.2.0) — useMotion's inViewOptions
  useMotion(() => ({ animate: ..., inViewOptions: { root: rootEl() } }))
  ```

  Affects `createInView`'s options and `MotionOptions.inViewOptions`. Note:
  `inViewOptions` itself is NOT accessor-shaped — reactivity comes from
  wrapping the surrounding `MotionOptions` in an accessor.

- **`DragConstraints` no longer accepts a function arm.** The
  `() => HTMLElement | null` variant is removed. Static `HTMLElement` or
  the rect-object form (`{ top, left, right, bottom }`) only. Reactivity
  comes from wrapping the whole `MotionOptions` in an accessor:

  ```ts
  // before (0.1.x)
  useMotion({ drag: true, dragConstraints: () => containerEl() })

  // after (0.2.0)
  useMotion(() => ({ drag: true, dragConstraints: containerEl() }))
  ```

- **`createScroll` options dropped per-field accessors.** `container` and
  `target` are now static `Element | null`. Reactivity comes from wrapping
  the whole options in an accessor:

  ```ts
  // before (0.1.x)
  createScroll({ container: () => containerEl() })

  // after (0.2.0)
  createScroll(() => ({ container: containerEl() }))
  ```

### Changed

- **Every primitive that takes options now accepts `Accessor<Options> | Options`.**
  Standardized on Solid's `Accessor<T>` type alias across the public surface.
  Affects `useMotion`, `createMotion`, `createScroll`, `createInView`,
  `createPan`. Existing call sites using either the static or function form
  continue to compile — the static-object call sites were always accepted,
  and the previous `() => Options` shape is structurally identical to
  `Accessor<Options>`.

- **Top-level refs in `createInView` and `createPan` now accept a static
  `Element`/`HTMLElement` in addition to an accessor.** Previously these only
  accepted the function form. Existing accessor call sites are unchanged.
  Note: static-ref call sites are captured ONCE; they do NOT re-attach when
  the variable changes — use the accessor form for reactive refs.

### Added

- **`createSpring` and `createTransform` accept reactive options.** When
  options (or, for `createTransform`, the input/output ranges) change, the
  underlying spring or transform engine is recreated; the output
  `MotionValueAccessor` identity is preserved so existing `.on("change")`
  subscriptions and `useMotion({ animate: { x: spring } })` references
  continue to work.

  `createSpring` retunes mid-flight **preserve the visual position** (via
  an internal tempSource pattern) but reset internal velocity to 0 — there
  is no public motion-dom API for seeding initial velocity. If you need to
  retain velocity across a retune, wrap your options in `createMemo` so
  recreates only happen on coarse-grained changes.

## [0.1.7] — 2026-05-22

### Fixed

- **`createScroll` no longer paints a fully-filled progress bar on
  client-side route navigation.** motion-utils' `progress()` returns `1` as
  its edge-case fallback when `scrollHeight === clientHeight` (no
  scrollable content). On a `<Presence mode="wait">` page transition, the
  new route's `createScroll` subscribes while the new content is still in
  Solid's wait-mode holding pen (off-DOM) — so the document's scroll
  dimensions reflect only the outgoing route. If the outgoing route is
  non-scrollable, motion-dom's first dispatch arrives with
  `progress === 1`, `current === 0`, and `scrollLength === 0`, and the
  user sees a 100%-full bar until the next user scroll.

  `createScroll` now suppresses that edge-case dispatch and waits for a
  real measurement (non-zero `scrollLength` on either axis OR non-zero
  `current`) before forwarding values to the MotionValues. The MVs stay
  at their initial `0` until layout resolves, then update once.

### Added

- **`createScroll` accepts a `trackContentSize?: boolean` option, defaulting
  to `true`.** motion-dom's per-frame dimension check is what fires the
  listener again once the new route's content swaps into the live DOM,
  naturally flipping the suppression gate above. The overhead is two
  property reads per frame per container — negligible. Users who know
  their scroll surface size never changes can opt out with
  `trackContentSize: false`.

### Internal

- `makeAccessor` in `motion-value` switched from manual
  `createSignal` + `mv.on("change", ...)` to Solid's `from()` primitive —
  the standard pattern for adapting subscribe-shaped sources to Accessors.
  Observationally identical; cuts ~6 lines per primitive.
- `createInView` now carries a doc-header explainer for why it uses
  `IntersectionObserver` directly instead of wrapping motion's `inView()`
  (array thresholds and symmetric enter/leave reactivity, both of which
  motion's wrapper doesn't surface).

## [0.1.6] — 2026-05-21

### Fixed

- **Nested motion inside `<Presence>` now reliably runs its first
  animate.** Previously, motion's enter-readiness gate flipped true via
  Presence's `beforeMount` callback unconditionally — but for nested
  motion elements inside a deeper `<Presence>` whose `onEnter` fires
  synchronously during render (while the surrounding tracked subtree is
  still off-DOM in a wait-mode holding pen), this caused the diff
  effect's first `animate(el, ...)` to fire against a disconnected
  element. WAAPI ran the animation to completion off-DOM and silently
  dropped `commitStyles`, so the element painted at its `initial` target
  with no visible transition.

  Both signals that could trip readiness now route through a shared
  `isConnected` check: Presence's `beforeMount` callback AND the
  microtask fallback flip ready only when `el.isConnected === true`,
  otherwise schedule a `requestAnimationFrame` retry until connectedness
  flips (or the owner is disposed). This handles three previously-broken
  scenarios:
  - Nested motion descendants of a Presence's tracked subtree
  - Initial children of `<Presence initial={false}>` (appear=false)
  - Direct tracked children whose nested `<Presence>` fires
    `beforeMount` synchronously while the parent subtree is still
    off-DOM (the canonical case: a page-transition wrapper around
    routes that themselves contain `<Presence>`)

  New regression test in `tests/presence.test.tsx` asserts a nested
  motion descendant's animate target reaches the animate spy on both
  initial mount AND on a `<Presence>` swap.

## [0.1.5] — 2026-05-21

### Fixed

- **Drag now sets `touch-action` upfront on the element** when `drag` is
  configured, not just inside `handlePanStart` after threshold cross.
  Previously, on mobile, the browser would arbitrate the gesture as
  native scroll/zoom and fire `pointercancel` before motion's own
  touch-action write could take effect — manifesting as missed drags
  or, when the user's `onDragEnd` made a threshold-based decision off
  stale `info.offset`, an immediate dismiss-on-touch (visible in the
  swipe-stack demo: every press fired a left-swipe).

  Axis mapping mirrors motion-react:
  - `drag="x"` → `touch-action: pan-y` (browser keeps vertical scroll)
  - `drag="y"` → `touch-action: pan-x`
  - `drag={true}` → `touch-action: none`

  User-supplied `style.touch-action` still overrides via natural
  spread precedence — e.g., `style={{ touchAction: "auto" }}` opts back
  into the browser's default arbitration. Three regression tests added.

  Removes the need for users to remember to set `touch-action: none` on
  every draggable element — `<motion.div drag="x">` now Just Works on
  touch devices.

## [0.1.4] — 2026-05-21

### Added

- **`dragListener` option** on `useMotion` / `<motion.X>` / `motion.create`.
  Mirrors motion-react's prop. Defaults to `true`. When set to `false`,
  drag skips attaching its own pointerdown listener to the element —
  drag becomes external-only, triggered through `dragControls.start(e)`
  from a handle elsewhere. The canonical case is a scrollable drawer
  body where direct pointer interaction must stay scroll-only, and a
  dedicated edge handle is the single drag affordance.

  ```tsx
  const controls = createDragControls()
  return (
    <motion.aside drag="x" dragControls={controls} dragListener={false}>
      {/* body stays scrollable — no drag from direct touch */}
      <span onPointerDown={(e) => controls.start(e)}>handle</span>
    </motion.aside>
  )
  ```

## [0.1.3] — 2026-05-21

### Fixed

- **`onDragEnd` now fires at the very end of pan-end** (after motion's
  `whileDrag` flip, body-style restore, pointer-capture release, momentum
  / snap-back dispatch, AND MV-ref cleanup) instead of mid-handler. A
  synchronous state flip from a user `onDragEnd` callback — e.g. closing
  a Kobalte / Radix-style Dialog whose contents are the draggable — used
  to race motion's later DOM-touching work and could wedge surrounding
  libraries that observe the same DOM (scroll lock, pointer-event
  layer-stack). The new ordering closes the race: by the time the
  callback runs, the drag session is fully torn down and any reactive
  cascade triggered from it is unambiguous about ownership.

  Observationally compatible with the previous behavior for callbacks
  that don't flip global state; users can keep their callbacks as plain
  synchronous functions and drop `queueMicrotask` workarounds.

## [0.1.2] — 2026-05-20

### Fixed

- **Drag now coexists with `initial` / `animate` / `exit`.** A draggable
  element with an entrance animation (`<motion.X drag initial={{x:-300}}
  animate={{x:0}}>`) used to break in two ways: animate's `x`/`y` never
  reached the DOM, and on pointerdown the element snapped back to the
  initial position. Three linked fixes:
  - Drag's exclusion of `x`/`y` from the gesture-state winners is now
    gated on `active.whileDrag` (pointer-engaged) instead of
    `dragEnabled` (configured), matching motion-react. Animate's `x`/`y`
    flow normally while drag is configured but idle; drag only claims
    them during active interaction.
  - The diff effect's removed-key fallback no longer reverts `x`/`y` to
    `initial` when drag activates and excludes them. Drag *claiming* a
    key is not the same as removing it.
  - `handlePanStart` now syncs the x/y MotionValues to the element's
    current visible translate (parsed from `getComputedStyle` +
    `el.style.transform`) before capturing `dragStart`. motion's
    `animate(el, target)` interpolates style.transform via WAAPI but
    doesn't keep the visualElement's MVs in sync, so the MV would still
    hold the entrance start value when drag began.

## [0.1.1] — 2026-05-20

### Docs

- Expanded README with a 12-recipe "Recipes" section covering the full v0.1
  surface: reactive `useMotion`, `<motion.X>` proxy + variant cascade,
  `motion.create` HOC, MotionValues + `createTransform`/`createSpring`,
  `createScroll`/`createInView`/`createTemplate`, `<Presence>` (single +
  list + `mode="wait"`), drag with constraints, `<MotionConfig>` +
  `createReducedMotion`.

## [0.1.0] — 2026-05-20

First public release. Five phases of the port plan land together: the canonical
animation surface, gestures + drag, exit animations via `<Presence>`, the
JSX-level `motion.X` proxy + `motion.create(...)` HOC, and motion values
embedded directly in `style` (`style={{ x: mv }}`).

### Added — primitives (Phase 1)

- `useMotion(opts)` — canonical hook. Returns a callable `m` that merges user
  props with motion's. Accepts a static options object or a function for
  reactive options (Solid signals tracked inside).
- `createMotion(el, opts)` — imperative primitive underneath `useMotion`.
- The `MotionValueAccessor<T>` callable-hybrid family — every primitive is
  both a Solid Accessor and an upstream `MotionValue`:
  - `createMotionValue<T>(initial)`
  - `createTransform<I, O>(input, range, output, opts?)`
  - `createSpring(source, opts?)`
  - `createTime()`
  - `createVelocity(source)`
  - `createTemplate\`…\``
  - `createMotionValueEvent(mv, event, cb)`
  - `toSignal(rawMv)` — bridge for raw upstream `motion.motionValue()`
- `createScroll(opts?)` — scroll progress with four fields, all
  `MotionValueAccessor<number>`.
- `createInView(ref, opts?)` — boolean Accessor, supports `amount: number[]`
  for live `intersectionRatio` readouts.
- `createReducedMotion()` — boolean Accessor backed by `matchMedia`.
- `<MotionConfig>` — flows `reducedMotion`, default `transition`, and CSP
  `nonce` to descendants.
- Variant resolution: `VariantContext`, `useVariantContext`, `resolveVariant`,
  `effectiveLabels`, `isControllingVariants` — full motion-dom parity for
  variant cascade and the "controlling" rule.

### Added — gestures + drag (Phase 2)

- `hover`, `press`, `focus`, `inView` gestures via motion-dom primitives,
  surfaced through `MotionOptions`.
- `createPan` standalone primitive (Q11 / D3 base) — pointer-pan with
  velocity callbacks.
- `createDrag` via motion-dom `VisualElement` — axis-locked dragging,
  elastic constraints, release momentum with bounce-back, snap-to-origin,
  `whileDrag` variant.
- `createDragControls` factory + `dragControls` prop for external drag-handle
  composition (Q9).
- Solid-native gesture state machine with priority order
  `exit > drag > inView > focus > press > hover > animate > initial`.
- `ViewportOptions.amount` accepts `number[]` for stepwise viewport progress.

### Added — Presence (Phase 3)

- `<Presence>` component for exit animations. Auto-detects single-child
  (`<Show>`-style switch) or list (`<For>`-style) via first resolution.
- `mode: "sync" | "wait"`, `initial` (default `true`).
- `useAnimatePresence()` hook — sibling primitive over the same context;
  returns `{ Provider, exit() }` for imperative orchestration.
- Subtree-walk exit registration: ancestor `<Presence>` waits for nested
  motion descendants with `exit` targets, including reactive subtrees and
  off-DOM nodes.
- SSR pass-through: server emits the same JSX shape as the client (Solid
  hydration markers align cleanly).

### Added — JSX wrappers (Phase 4)

- `motion.div`, `motion.span`, `motion.path`, … — callable `Proxy` with a
  cached per-tag factory. Each tag-component auto-wraps its rendered output
  in the variant `Provider` so motion descendants inherit context without an
  explicit wrapper.
- `motion.create(Component)` — HOC for user components. Wrapped component
  must spread its props onto a single HTML/SVG element root (same implicit
  contract Solid already requires). Dev-mode wrap-validity check warns on
  misuse.
- SVG namespace handled via `<Dynamic>` from `solid-js/web`. Element types
  widened to `HTMLElement | SVGElement` (`MotionElement`).

### Added — MotionValues in `style` (Phase 5)

- `style={{ x: mv, scale: mv, opacity: mv, … }}` — motion-react fidelity.
  Plain numbers and `MotionValue`s mix freely; the engine cooperates by
  writing animation output back through the MVs (so external subscribers see
  the same stream).
- Per-element value registry (motion-react's `visualElement.values`).
- `animate(mv, value, opts)` bridge when a key has a registered MV;
  `animate(el, target, opts)` otherwise.
- Specialized writer + per-key formatter compiled at registry-shape change
  for transform composition without per-frame string reparsing.
- `MotionStyle = MotionTransformShortcuts & WithMotionValues<…>` — typed
  intersection that's assignable to both JSX `style` and back to `MotionStyle`
  for chaining.

### Added — tooling, infra, docs

- Dual-publish manifests for npm (`solidjs-motion`) and JSR
  (`@solidjs-motion/motion`).
- Vite library mode build (`vite-plugin-solid` + `vite-plugin-dts`); ship-source
  pattern with the `solid` export condition listed before `types` so consumers
  using `vite-plugin-solid` resolve to raw source.
- Vitest harness — 141+ tests across browser (jsdom) and SSR (separate
  `vitest.ssr.config.ts`), plus compile-time type tests via `expectTypeOf`.
- `vitest bench` suite (Phase 4 verification gate) — 8 benches covering
  proxy/explicit, `useMotion` mount, state-machine flip, MotionValue fanout
  + construction, drag tick, variant resolution, Presence roundtrip.
  Baselines in `bench/BASELINES.md`.
- `MotionConfig` CSP nonce flow.
- ADRs: 0001 (lean on motion-dom for Phase 2), 0002 (Solid-native gesture
  state machine), 0003 (Presence via transition-group + inverted context),
  0004 (motion proxy + HOC), 0005 (MV-in-style via per-element value
  registry).

[0.1.0]: https://github.com/solidjs-motion/motion/releases/tag/v0.1.0
