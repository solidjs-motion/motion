# motion proxy + `motion.create` HOC

Phase 4 needed JSX-level wrappers that match motion-react's `<motion.div>` ergonomic: variant context flowing through descendants without users threading `m.Provider` manually, motion options separated from element attributes by name rather than position, and a Solid-friendly equivalent of `motion(Component)` for wrapping custom components. The original plan was a polymorphic `<Motion as="div">` component; that got dropped in favor of a Proxy-based surface during the design grill.

**Decision:** A single `Proxy` that is both indexable (`motion.div`, `motion.path`) and exposes a reserved `motion.create(Component)` HOC entry point. Both surfaces share the same `useMotion`-driven body, the same `MOTION_OPT_KEYS` prop split, and the same auto-`m.Provider` wrap.

## Load-bearing details

- **Unconditional `m.Provider` wrap (B1).** Every tag-component and the HOC wrap their rendered output in `m.Provider`. The cost is one Solid context push per motion element; the benefit is zero-config variant orchestration. Combined with Phase 3's passive-cascade-exit registration (commit `c3a80e9`), this is the mechanism that makes `<motion.div animate="open" exit="closed" variants={…}>{ passive children }</motion.div>` orchestrate end-to-end — enter AND exit — without the user wiring `m.Provider` or repeating labels on each child.

- **Reactive prop spread via `mergeProps`-based `m()`.** Without this, `<motion.div class={signal()}>` would freeze the class after first render — the previous eager-spread `getProps` snapshotted `userProps` at call time. The Phase 4 commit chain starts with a `getProps` refactor (commit `575bc3a`) that builds the merged props via Solid's `mergeProps` instead of an eager spread. Non-motion reactive props (class, dynamic style, event handlers) keep reactivity through to the rendered element; `style` is a getter on the override object so motion's initial style still layers on top of reactive user style. This is the unlock for the proxy.

- **`MOTION_OPT_KEYS` exhaustiveness check.** A 40-key `as const satisfies readonly (keyof MotionOptions)[]` array guards typos. A `_ensureExhaustive` type-level assertion using `Exclude<keyof MotionOptions, typeof MOTION_OPT_KEYS[number]>` surfaces any missing key by name in the compile error. Adding a new option to `types.ts` without updating the array fails to compile.

- **`<Dynamic>` for SVG/HTML namespace.** Each tag-component delegates the actual `createElement` to Solid's `<Dynamic>`, which checks an internal `SVGElements` set and uses `createElementNS` for SVG tags. Cost is ~5-8µs per element mount (two extra `createMemo` allocations + a Set lookup) — invisible against the ~300µs of state-machine + ref setup. Codegen-per-tag would save the µs but multiply the bundle by ~30KB minimum and require a build step.

- **HOC contract: ref-forwarding enforced at runtime, not at the type level.** Solid has no `forwardRef` equivalent, and `ref?` props are conventionally optional. Structural typing makes any constraint like `P extends { ref?: ... }` trivially satisfied by components that don't declare `ref` at all (missing-optional ≡ has-optional-and-undefined). So compile-time enforcement of "you forwarded ref" isn't achievable. Instead, the HOC injects a sentinel into `rest.ref` via `mergeProps` — `m()`'s internal `mergeRefs` combines the sentinel with motion's own ref, so both fire together when the wrapped Component forwards `props.ref` to a DOM element. After `onMount` + a microtask, if the sentinel hasn't fired, the wrap is broken; we log an actionable warning. All dev-mode logic gates on `process.env.NODE_ENV` so production builds compile it out.

## Why not the original `<Motion as="div">` plan

Three reasons:

1. **Polymorphic component types are awkward in Solid.** TypeScript has `ElementType` for React-style polymorphism, but Solid doesn't have an idiomatic equivalent. The `<motion.X>` proxy form expresses the per-tag prop shape via a mapped type over `JSX.IntrinsicElements`, which TS solves natively.
2. **`<motion.X>` is the idiom 99% of motion users already know.** Mirror their muscle memory rather than invent a Solid-specific spelling.
3. **The Proxy is one module-level construct.** A polymorphic `<Motion as="div">` would be a generic component instantiated per call site, paying the lookup cost for every render. The Proxy's tag-component cache is allocated once per unique tag and reused.

## Why `motion.create()` rather than callable `motion(Component)`

motion-react migrated away from callable `motion(...)` in their newer versions: `motion.create(Component)` is discoverable via autocomplete alongside the tag names, doesn't require a callable Proxy target, and reads more naturally in code. We followed. The Proxy's target is a plain object `{}` (no `apply` trap needed); the `get` trap routes `"create"` to the HOC function before falling through to `makeMotionTag` for tag access. Reading `motion.create === motion.create` holds because the HOC is a single module-level function returned directly.

## Tradeoffs

- **HOC wrap-validity is a runtime check, not compile-time.** Users who wrap a broken Component get a dev-mode warning at mount time with an actionable message, not a type error at the wrap site. Documented; matches Solid's general "ref forwarding is by convention" reality.
- **`motion.create(motion.X)` double-wrap is allowed at runtime (no crash) but warned in dev.** Catching it at construction via the `motionComponents` WeakSet means the warning fires the moment `motion.create(motion.div)` is evaluated, before any element mounts.
- **40-key `MOTION_OPT_KEYS` means every new `MotionOptions` key requires a list update.** The compile-time exhaustiveness check turns this into a forcing function rather than a silent regression — TS surfaces the missing key by name.
- **`process.env.NODE_ENV` gating.** Vite handles the substitution; consumers without a bundler that does so (rare for Solid users) would see the dev-mode warnings always run. Acceptable; documented in the JSDoc.

## Reversibility

High. The public surface — `motion.div`, `motion.path`, `motion.create(Component)`, and the `Motion` type — matches motion-react closely. Internals could be swapped (codegen-per-tag, a different cache shape, a callable Proxy target if `motion.create` ever needs to also be `motion(...)`) without breaking callers. The biggest risk is the auto-`m.Provider` wrap: removing it would silently break passive-cascade exit (which depends on motion children being inside an `m.Provider`-supplied VariantContext), so future refactors must preserve that boundary even if they reshape the surrounding code.
