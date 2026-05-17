# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project identity

This workspace ships **one** publishable library under three names. Don't conflate them.

| Surface | Identifier |
|---|---|
| npm | `solidjs-motion` |
| JSR | `@solidjs-motion/motion` |
| GitHub | `solidjs-motion/motion` |
| Internal workspace package | `packages/motion/` |

The repo is named `motion` (not `solidjs-motion`) because the org name is already `solidjs-motion` — repeating it would be redundant. Inside the repo, the term **`motion`** refers to this library. The npm package `motion` (the framework-agnostic animation engine we wrap) is always written out explicitly as "the `motion` npm package" or "upstream `motion`" to avoid collision.

## Architecture

The library is layered:

```
                createMotion(el, opts)        ← imperative primitive
                          ↑
                    useMotion(opts)           ← canonical public API
                          ↑
            ┌─────────────┴─────────────┐
            ↑                           ↑
       <motion.div>                motion(MyButton)
       (proxy, Phase 4)            (HOC, Phase 4)
```

`createMotion` is the imperative primitive that takes an element + reactive options. `useMotion` wraps it and returns a callable that merges user props with motion's (style merge, ref composition, SSR-friendly inline style). Phase 4 lands the JSX-level wrappers; the plan's original `<Motion as="...">` proposal was dropped in favor of the proxy-plus-HOC pattern.

**Reactivity opt-in via function form:**

```tsx
useMotion({ animate: { x: 100 } })             // static
useMotion(() => ({ animate: { x: x() } }))     // reactive — signals tracked
```

`initial` is captured once at construction. `animate`/gesture targets track Solid signals through the inner `createEffect`. MotionValues in target values take a separate subscription path (see "MV-in-target" below).

**SSR pattern:**

- Server: `useMotion` returns props with a deterministic inline `style` from `targetToStyle(initial)` plus `data-motion-hydrated=""`. HTML ships with the initial style.
- Browser: first paint matches server (no flicker).
- Hydration: ref runs, `createMotion` sees `initialAppliedBySSR: true`, skips the initial-style application, runs `animate()` to the target.

Hydration matching requires `targetToStyle` to be **pure and deterministic** — same input must produce byte-identical output on server and client.

**Build pipeline (ship-source pattern):**

- Library is published with both `src/` (TS source) and `dist/` (compiled JS + `.d.ts`).
- The `"solid"` export condition in `packages/motion/package.json` is listed **before** `"types"` so dev-mode TS resolution reads source directly (avoids stale-dist shadowing). External consumers without the `solid` condition fall through to `types`.
- Consumers using `vite-plugin-solid` (anyone in the Solid ecosystem) resolve to raw source and Babel-transform it themselves with `babel-preset-solid`. This is the pattern `@solidjs/router` and `solid-motionone` use; it's correct for SSR/hydration semantics.
- Inside this monorepo, the same condition powers HMR-through-source: edits to `packages/motion/src/*.ts` are picked up live by `examples/basic` without rebuilding the library.

## The `MotionValueAccessor` callable hybrid

Every Phase 1 primitive that produces an animatable value returns a **`MotionValueAccessor<T>` = `MotionValue<T> & (() => T)`** — a Proxy that's callable as a Solid Accessor AND has every upstream MotionValue method.

```tsx
const x = createMotionValue(0)

x()                                  // Solid-tracked read (use in JSX, createEffect)
x.get()                              // sync, untracked read (motion engine uses this)
x.set(100)                           // imperative write (fires the change subscription)
x.jump(50)                           // hard set, no animation
x.getVelocity()                      // upstream MotionValue method
x.on("change", cb)                   // raw subscription
useMotion({ animate: { x: x } })     // motion engine sees .getVelocity → treats as MV
animate(x, 200)                      // motion engine accepts as MV target
```

**Why this works**: motion's `isMotionValue` is duck-typed (`Boolean(v && v.getVelocity)`), and motion never uses `instanceof MotionValue` in its JS source. The Proxy forwards `.getVelocity` to the underlying MV, so `isMotionValue(callable)` returns true. `useMotion`'s `splitTarget` then routes the hybrid down the MotionValue subscription path.

| Primitive | Returns |
|---|---|
| `createMotionValue<T>(initial)` | `MotionValueAccessor<T>` |
| `createTransform<I,O>(input, range, output, opts?)` | `MotionValueAccessor<O>` |
| `createSpring(source, opts?)` | `MotionValueAccessor<number>` |
| `createTime()` | `MotionValueAccessor<number>` (driver) |
| `createVelocity(source)` | `MotionValueAccessor<number>` |
| `createTemplate\`...\`` | `MotionValueAccessor<string>` |
| `createScroll(opts?)` → 4 fields | each `MotionValueAccessor<number>` |
| `createInView(ref, opts?)` | `Accessor<boolean>` — boolean, not a motion value |
| `createReducedMotion()` | `Accessor<boolean>` — boolean, not a motion value |
| `toSignal(rawMv)` | `Accessor<T>` — bridge for raw upstream `motion.motionValue()` |

`createMotionSignal` was removed — the hybrid carries both behaviors so the tuple-return version became redundant.

## MotionValue-in-target subscription

`useMotion({ animate: { x: motionValue } })` is special: motion's vanilla `animate(el, target, opts)` doesn't subscribe to MotionValue refs in target values (that's motion/react's JSX-layer trick). `createMotion`'s `splitTarget` handles this:

1. Walk the target; split into `plain` values (plain numbers/strings, Accessor snapshots) and `motionValues` (the MV refs).
2. Initial `animate(el, plain, opts)` uses the MV's `.get()` snapshot.
3. For each captured MV: `onCleanup(mv.on("change", v => animate(el, { [key]: v }, opts)))` — every imperative `mv.set(...)` triggers a per-property re-tween. The `onCleanup` is iteration-scoped (fires on effect re-run AND owner disposal).

Without this plumbing, MotionValues in target would be inert — Solid's `createEffect` only tracks Solid signals, not motion values.

## Variant context propagation

Children of a motion element can inherit the parent's variant *name* via context (Q4 sub-3 Option B). The chain:

```
own.initial > parent.initial > own.animate > parent.animate
```

For both `createMotion`'s initial-style application AND `computeInitialStyle` in `useMotion`. The child resolves the inherited name in **its own** `variants` map (Pattern X / Q4 sub-1B — no `variants`-object cascade).

`useMotion` returns a `Provider` component for opt-in propagation:

```tsx
const m = useMotion({ animate: "visible", variants: {...} })
<div {...m()}>
  <m.Provider>
    <ChildComponent />  {/* sees parent's variant context */}
  </m.Provider>
</div>
```

Without `m.Provider`, children don't inherit. `useMotion` is a pure consumer of parent context, not a provider — only the JSX wrappers (`<motion.div>` etc. in Phase 4) propagate automatically.

## Solid primitive decision matrix

Different reactive primitives in this codebase, with rationale:

| When | Use | Why |
|---|---|---|
| Derive a value with **caching** + sync first run | `createMemo` | The value is read frequently; memo dedupes |
| Subscribe to an external source with cleanup + reactive options | **`createComputed`** | First iteration AND updates are synchronous (matches motion/react's "MV updates are immediate" semantic). Used in `createScroll`, `createInView`, `createTransform`, `createSpring`, `createTemplate`. |
| Side effect on signal change, frame-async tolerance OK | `createEffect` | Solid batches; `animate()` calls coalesce. Used in `createMotion`'s animate effect. |
| Bridge a subscribe-shaped source to an Accessor | `from` | Used in `createReducedMotion` for matchMedia |
| Read a signal once without tracking | `untrack` | Used at construction time in `useMotion`/`createMotion` to snapshot initial options |
| Effect-iteration-scoped cleanup | `onCleanup` **inside** the effect/computed | Fires on re-run AND owner disposal — no need for an outer `let cleanupCurrent` |

**Don't reach for**:
- `createRenderEffect` — runs first iteration sync but updates are batched (unlike `createComputed`). Misleading.
- Bare `setSignal(value)` when the type is unclear — wrap in updater form `setSignal(() => value)` so the Setter type accepts `T` regardless of shape.

## Tooling choices worth knowing

- **No Turborepo.** Bun workspaces with `--filter` only. Adding Turbo when there are 1–4 packages and no remote cache adds config overhead with little benefit; revisit if the build graph grows.
- **Biome 2.x** for lint and format. No ESLint, no Prettier. `eslint-plugin-solid` is not used (the wider Solid ecosystem — `@solidjs/router`, `solid-motionone` — also skips it; TS strict + tests catch reactivity bugs in practice).
- **Vite library mode** for the build (not tsup). Officially-maintained `vite-plugin-solid` and `vite-plugin-dts`. vite-plugin-dts 5.x renamed `outDir` to `outDirs` (array).
- **Vitest 4 + jsdom + `@solidjs/testing-library`.** `tests/setup.ts` polyfills `IntersectionObserver`. `passWithNoTests: true` keeps the harness green when a phase ships without tests.
- **Separate SSR test config** (`vitest.ssr.config.ts`) with `resolve.conditions: ["development", "node"]` so `solid-js/web` resolves to the server build where `renderToString` emits real HTML. The browser config excludes `tests/ssr/**`. Run both via `bun run test`.
- **TypeScript `customConditions: ["solid", "development"]`** in the base tsconfig. `tsc` resolves the library through the same `"solid"` export condition Vite does, so type checking against the library works without a build step.
- **`examples/basic` is plain Vite SPA, not SolidStart.** SolidStart is in a 1.x→2.x architecture transition; SSR demos will live in `examples/ssr-test` (Phase 6) once SolidStart 2.x stabilizes.

## Common commands

All commands run from the **workspace root**.

```bash
bun install                       # workspace install (single bun.lock at root)
bun run dev                       # start the basic example dev server
bun run build                     # build every package
bun run test                      # vitest run (browser + SSR) in every package
bun run typecheck                 # tsc --noEmit in every package
bun run lint                      # biome check .
bun run format                    # biome format --write .
bun run clean                     # remove dist/.turbo/node_modules everywhere

# Single-package targeting
bun --filter solidjs-motion test          # library tests only (browser + SSR)
bun --filter solidjs-motion test:ssr      # library SSR tests only
bun --filter solidjs-motion test:watch    # library tests in watch mode
bun --filter solidjs-motion build         # library build only
bun --filter basic dev                    # example dev server only

# Run a single test file
bun --filter solidjs-motion vitest tests/path/to/file.test.ts
```

**⚠️ `bun test` vs `bun run test`.** They route to different test runners.

- `bun run test` (always use this) → calls the `package.json` test script → invokes Vitest with our `vite.config.ts` + `vitest.ssr.config.ts`. 141 tests pass.
- `bun test` (avoid) → invokes Bun's *built-in* test runner. Our test files use Vitest APIs (`vi.mock`, `vi.fn`, `vi.spyOn`), jsdom env, `@solidjs/testing-library`, and the `vite-plugin-solid` JSX transform — none of which Bun's native runner understands.

The `bunfig.toml` in the repo root re-routes Bun's test root to `.bun-test-no-op/`, so `bun test` exits cleanly with "0 test files matching" instead of falsely reporting failures from running our files through the wrong runner.

**Verifying a build locally before publishing**: temporarily strip `"development"` and `"solid"` from `examples/basic/vite.config.ts`'s `resolve.conditions`, then run `bun --filter basic dev`. The example will import from `dist/index.js` instead of source. Revert after testing.

**Stale dist gotcha**: if you change library types and the example/tests still see old types, your `dist/index.d.ts` is stale. Either rebuild (`bun --filter solidjs-motion build`) or — preferably — ensure your TS resolution path goes through the `solid` condition to source (the customConditions in `tsconfig.base.json` does this, but in some corner cases a stale dist can still leak through). The exports map has `solid` listed first to minimize this; rebuild if you hit it.

## Conventions

- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- **Quotes / semis**: Biome-enforced style — double quotes, no semicolons except where required, trailing commas everywhere.
- **No default exports.** Named exports only.
- **Explicit return types on every exported function.** JSR's "slow types" check requires this; also keeps the public API surface deliberate.
- **JSDoc on every public API** with `@example` blocks. JSR auto-generates docs from these.
- **No CJS.** ESM only.
- **Don't import from `motion/react`.** Animation primitives come from `motion`: `import { animate, spring, inView, scroll, motionValue, isMotionValue } from "motion"`.
- **`motion-dom` is an explicit dependency.** Phase 2 reverses Phase 1's "no motion/dom paths" rule. Imports from `motion-dom` are allowed and expected: `hover`, `press`, `visualElementStore`, `createDOMVisualElement`, `addDomEvent`, `frame`/`cancelFrame`/`time`, `isPrimaryPointer`, `distance2D`, `setDragLock`/`isDragActive`, `variantPriorityOrder`, `animateVisualElement`, `getValueTransition`, `stagger`. Some of these lack public `.d.ts` types (e.g., `visualElementStore`, `createDOMVisualElement`); cast where needed and pin compatibility. Rationale: [docs/adr/0001-lean-on-motion-dom-for-phase-2.md](docs/adr/0001-lean-on-motion-dom-for-phase-2.md).
- **Solid reactivity discipline**: pick the right primitive from the decision matrix above. `onMount` for one-time setup, `onCleanup` for teardown. Never destructure props at the top of a function (use `splitProps`).
- **Test runner**: always `bun run test`, never `bun test`. See the warning above.

## Phase 1 status

Phase 1 ships the canonical animation surface:

- `useMotion` (canonical hook) + `createMotion` (imperative primitive)
- The MotionValue family (callable hybrids): `createMotionValue`, `createTransform`, `createSpring`, `createTime`, `createVelocity`, `createTemplate`, `createMotionValueEvent`, `toSignal`
- Scroll/visibility: `createScroll`, `createInView`
- Reduced motion: `createReducedMotion`, `<MotionConfig>`
- Variant resolution: `VariantContext`, `useVariantContext`, `resolveVariant`, `effectiveLabels`
- Presence wiring: `PresenceContext`, `usePresenceContext` (no-op default; `<Presence>` lands Phase 3)
- Re-exports from upstream `motion`: `animate`, `inView`, `isMotionValue`, `motionValue`, `scroll`, `spring`

**Tests: 141 total** (131 browser + 10 SSR) + compile-time type tests via `expectTypeOf` in `tests/types.test-d.ts`.

**Phase 2 ahead**: gestures (`hover`, `press`, `focus`, `inView`, `pan`) and drag. Gesture hook surface is already typed in `MotionCallbacks` — Phase 2 wires the runtime.
**Phase 3 ahead**: `<Presence>` for exit animations (`PresenceContext` is already wired with a no-op default).
**Phase 4 ahead**: `<motion.div>` proxy + `motion(Component)` HOC. JSX-level wrappers that auto-propagate variant context.

## Identity-sensitive places to update together

When changing the library's name, scope, or repo, these all have to move in lockstep:

- `packages/motion/package.json` — `name`, `repository.url`, `repository.directory`, `bugs.url`, `homepage`
- `packages/motion/jsr.json` — `name`
- `examples/basic/package.json` — workspace dep name (`"solidjs-motion": "workspace:*"`)
- `examples/basic/src/main.tsx` — `import` specifier
- `LICENSE` and `packages/motion/LICENSE` — copyright holder line
- `README.md` and `packages/motion/README.md` — install commands, install instructions
