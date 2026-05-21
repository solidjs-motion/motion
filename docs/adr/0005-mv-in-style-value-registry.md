# MV-in-style via per-element value registry

motion-react treats `style={{ scale: mv }}` as **making the MotionValue the source of truth for that key**: the user's MV drives the DOM directly via subscription, AND any `animate` target on the same key tweens **through** the MV (`mv.set(v)` per frame) rather than writing the element directly. This is the central architectural feature that lets users compose `style` + `animate` + variants + gestures without per-key conflicts. solidjs-motion needed an equivalent — without it, `style={{ scale: mv }}` either was unsupported or would silently fight `animate.scale` on the inline `transform` string.

The complication: there can only be **one writer** for `el.style.transform`. Today every motion path that affects a transform shortcut (style MV, static style shortcut, `initial` target, `animate` target, gesture targets, exit target) has to cooperate on that one string. Without a unifying mechanism, two writers would race per frame.

**Decision:** Each element managed by `createMotion` gets a **per-element value registry** — a `Map<string, MotionValue>` keyed by the motion key (`scale`, `x`, `opacity`, etc.) plus a `Set` tracking which entries are registry-owned (transient) vs. user-owned (external). A single **swappable writer closure** subscribes to every MV in the registry and is the **only** code path that writes `el.style.transform`. Animate dispatches route through the registry: when a key has a registered MV, the animation tweens the MV (the writer then writes the DOM); when it doesn't, animate falls back to WAA against the element directly.

## Load-bearing details

- **Lazy registry allocation.** Most elements never use MV-in-style. The registry is created on first `setExternal` / `getOrCreateTransient` call, not unconditionally per `createMotion`. Combined with lazy-allocation of useMotion's `styleMotionValues` / `styleStaticTransforms` maps (Stage 4.5a), users who never write `style={{ key: mv }}` pay zero allocation overhead.

- **Bridge activation only when external MVs exist.** `bridgeActive=true` requires at least one user-provided style MV or static style transform-shortcut. Without that, `getValueForAnimate` returns `undefined` for every key and the state machine stays on its pre-existing `animate(el, target, opts)` WAA dispatch. This means the 293 baseline tests' `animateSpy.mock.calls[*][1]` assertions still see a target *object* — bridging didn't break the legacy dispatch shape, it added a parallel path that only kicks in for MV-using elements.

- **Single-writer-per-transform, by construction.** When bridging is active, every transform-shortcut target — `style` MV, `style` static shortcut, `initial` value, `animate` target via transient MV — flows through the same registry. The writer composes them in motion's canonical order (`translate → scale → rotate`, see `TRANSFORM_ORDER` in `style.ts`). Two writers can't race because there's only one writer.

- **Specialized writer closure compiled at registry-shape change.** With 1 entry, the writer is a closure that captures `(key, mv)` and a pre-picked `transformFunctionFor`-equivalent (no `Set.has` lookup, no `switch` over 15 transform-shortcut keys per call, no iterator allocations). With 2+ entries, it falls back to `applyStaticStyle` which composes the full transform string. `refreshWriter()` swaps between them when registry size transitions through 0/1/2+. Measured impact at Sierpinski depth 8 (6,561 dots × 60 Hz): per-call cost ~240 ns → ~110 ns, and 1.2M allocations/sec of GC pressure removed.

- **Animate-through-MV uses `motion.animate(mv, value, opts)`.** motion's `animate()` is overloaded: passing a `MotionValue` as the first arg tweens the MV's value via `mv.set` per frame rather than writing the element. We exploit this — the bridge's `getValueForAnimate(key, fallback)` returns the existing external MV when present, else `getOrCreateTransient(key, fallback)`. The state machine then issues per-key `animate(mv, value, opts)` calls; on each MV tick, the writer composes the new transform. The aggregate handle (`aggregateControls`) combines per-MV controls + an optional single WAA call for non-routed keys so `prevControls.stop()` and the exit-drain `.then(...)` work uniformly.

- **SSR composition via `composeFirstPaintStyle`.** `useMotion`'s style getter (before `renderedOnce` flips) builds a merged Target from `initialTarget` + `styleMotionValues` snapshots + static transform shortcuts, then runs `targetToStyle` once. The composed CSS lands in the SSR HTML, so the server-rendered output already contains the MV's value at render time. Client first-paint composes the same target the same way → byte-identical → silent hydration. Post-mount, `renderedOnce` flips and the registry-writer takes over.

- **`MotionStyle` type uses `MotionValue<any>` for the MV slot.** motion's `MotionValue<T>` is invariant in `T` (it has both `get(): T` and `set(v: T)`). A user's `MotionValue<number>` cannot widen to `MotionValue<unknown>`, so `MotionValue<any>` is the only shape that accepts any concrete MV. Documented in `types.ts`; the runtime always normalizes via `mv.get()` and `formatProperty` so value-type safety is recovered at the renderer.

- **`MotionMergedProps.style` is `MotionStyle & JSX.CSSProperties` (intersection).** The output prop has to be assignable in two directions: spread onto raw JSX (`<div {...m({})} />` requires `JSX.CSSProperties`) AND chained back into another `useMotion` (`fade(slide({}))` requires `MotionStyle`). The intersection narrows to a type that's assignable to both — MV variants collapse out against `CSSProperties`'s primitive types, matching the runtime which strips MVs before Solid sees them.

## Why a per-element registry and not a global one

Each motion element has independent state: its own initial, animate, gesture activations, exit. A global registry keyed by element would work but adds a Map lookup per access on the hot path; per-element keeps the registry's reference in the surrounding `createMotion` closure, so the writer's call site reads it directly. Memory cost is identical (a Map per element either way) — runtime cost is lower in the per-element form.

## Why not pure Solid signals (no motion MVs)

A pure Solid implementation would gain finer-grained reactivity and batch coalescing through Solid's scheduler. But:

- motion's animation engine (`animate()`, `spring()`, `inertia()`, drag physics, the WAA bridge for non-MV writes) is ~10kLOC of well-tested code that expects `MotionValue` instances. Replacing it means re-implementing that engine.
- motion's `MotionValue` carries velocity history, integrates with motion-react's visualElement, and is the cross-framework primitive (motion-vue, motion-vanilla, motion-react all consume the same type). Forking it would forfeit upstream bug fixes and pre-existing user knowledge.
- Performance is "good enough" with motion MVs: at Sierpinski depth 7 (~2,200 elements) the dev build sits around 40 fps, and the remaining ceiling is browser-bound (per-element style recalc + paint), not JS-bound.

A v0.2 / v1.0 revisit is reasonable if perf becomes a competitive necessity, but it's a multi-month rewrite and gates on shipping v0.1 first.

## Tradeoffs

- **Mount cost grew.** Per `useMotion` + `createMotion` pair adds ~5 closures + lazy Map allocations + bridge-detection branches. Synthetic bench numbers were too noisy on a dev machine to commit a precise figure, but typical apps (10-50 motion elements) won't perceive it; Sierpinski-scale apps see noticeable one-time mount cost (~325ms at depth 8) but no steady-state penalty.

- **The `MotionStyle` type lies slightly.** `MotionMergedProps.style` is typed as `MotionStyle & JSX.CSSProperties`. The intersection drops MV variants against CSS primitive types, so reading `merged.style.scale` after `m()` is typed as `number | string | undefined`. The runtime strips MVs before Solid sees them, so the type is honest at the *runtime* moment — but a TypeScript reader of intermediate values might be surprised. Documented in the type.

- **Bridge is all-or-nothing per element.** When `bridgeActive=true`, every transform-shortcut animate target gets routed through a transient MV (creating it if needed). There's no "bridge some keys, leave others to WAA" — the writer owns `el.style.transform` exclusively. Cooperation with non-transform animate keys (opacity, etc.) is fine because they don't share the transform string; transform-only bridging is correct by construction but loses the option to selectively WAA-animate a transform shortcut when bridging is active.

- **Reactive MV swap not supported.** `style={{ scale: cond() ? mvA : mvB }}` is documented as unsupported — the MV scrape runs once on the first `m()` call. The contract was locked during the grill; reactive swap could be added in v0.2 if a real use case appears, but it'd require re-subscribing on every render which has its own perf cost.

## Reversibility

- **Public surface (`MotionStyle`, `<motion.X>`, `useMotion`, `createMotionValue`) is stable.** Anything beneath that line can be replaced.
- **Specialized writer closure** could be retired in favor of a different per-element write strategy — direct mutation, frame-batched coalescing via `requestAnimationFrame`, a Solid-effect-based render loop. The writer is fully encapsulated in `createMotion`; consumers see only `el.style.transform` being correct.
- **Lazy registry** could be made eager again, or moved to a global map keyed by element, without breaking callers.
- **Bridge** is the load-bearing piece. Removing it (e.g., reverting to WAA-only for transform animations) would re-introduce the style-MV vs. animate-target conflict and break the motion-react fidelity contract. Future refactors must preserve "single writer for `el.style.transform`."

## What's deferred

- **Per-element profiling on a stable CI bench.** Mount cost regression vs baseline is somewhere between "1%" and "20%" on noisy dev hardware. A deterministic bench environment (isolated CI runner, multi-sample averaging) is necessary before further mount-time optimizations are justified.
- **Stage 4.5b/c/d-style further perf passes.** Module-level closure extraction, gated `getValueForAnimate` creation, additional fast paths. Wait for measured signal before chasing.
- **A `style: { scale: mv }`-compatible spring chain via `createSpring(mv)`.** Already works (createSpring returns a MotionValueAccessor) but no explicit test or demo covers the chain. Worth a demo for v0.2.
- **Solid-native MotionValue rewrite.** Discussed above; explicitly out of v0.1 scope.

## References

- Stage 1 — value registry foundation: `74fee83`
- Stage 2 — style MV scrape + subscribe: `8fb6561`
- Stage 3 — animate bridge through registered MVs: `b68ce56`
- Stage 4 — initial + style MV composition (client + SSR): `a532750`
- Stage 4.5a — lazy registry + maps: `c218c31`
- Stage 4.5b — specialized writer + formatter pre-pick: `a1f4aaa`
- Stage 5 — `MotionStyle` type + JSX widening: `ea203cc`
- Stage 6 — type assertions + motion.X MV-in-style runtime tests: `17c099d`
- Sierpinski Triangle demo: `b9dc6aa`
