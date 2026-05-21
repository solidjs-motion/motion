# Changelog

All notable changes to `solidjs-motion` / `@solidjs-motion/motion` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
