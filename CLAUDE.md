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
       <Motion as="div" />          use:motion={opts}
       (sugar component)            (sugar directive)
```

`createMotion` is the imperative primitive that takes an element + reactive options. `useMotion` wraps it and returns a `getProps(userProps?)` function that merges user props with motion's (style merge, ref composition, SSR-friendly inline style). `<Motion>` and `use:motion` are thin sugar on top.

**Reactivity opt-in via function form:**

```tsx
useMotion({ animate: { x: 100 } })             // static
useMotion(() => ({ animate: { x: x() } }))     // reactive — signals tracked inside createEffect
```

`initial` is captured once at construction. `animate`/gesture targets track signals through the inner `createEffect`.

**SSR pattern:**

- Server: `useMotion` returns props with a deterministic inline `style` from `targetToStyle(initial)` plus `data-motion-hydrated=""`. HTML ships with the initial style.
- Browser: first paint matches server (no flicker).
- Hydration: ref runs, `createMotion` sees `initialAppliedBySSR: true`, skips the initial-style application, runs `animate()` to the target.

Hydration matching requires `targetToStyle` to be **pure and deterministic** — same input must produce byte-identical output on server and client.

**Build pipeline (ship-source pattern):**

- Library is published with both `src/` (TS source) and `dist/` (compiled JS + `.d.ts`).
- The `"solid"` export condition in `packages/motion/package.json` points to `./src/index.ts`. Consumers using `vite-plugin-solid` (anyone in the Solid ecosystem) resolve to raw source and Babel-transform it themselves with `babel-preset-solid`. This is the pattern `@solidjs/router` and `solid-motionone` use; it's correct for SSR/hydration semantics.
- Inside this monorepo, the same condition powers HMR-through-source: edits to `packages/motion/src/*.ts` are picked up live by `examples/basic` without rebuilding the library.

## Tooling choices worth knowing

- **No Turborepo.** Bun workspaces with `--filter` only. Adding Turbo when there are 1–4 packages and no remote cache adds config overhead with little benefit; revisit if the build graph grows.
- **Biome 2.x** for lint and format. No ESLint, no Prettier. `eslint-plugin-solid` is not used (the wider Solid ecosystem — `@solidjs/router`, `solid-motionone` — also skips it; TS strict + tests catch reactivity bugs in practice).
- **Vite library mode** for the build (not tsup). Officially-maintained `vite-plugin-solid` and `vite-plugin-dts`. Plan-divergence note: vite-plugin-dts 5.x renamed `outDir` to `outDirs` (array).
- **Vitest 4 + jsdom + `@solidjs/testing-library`.** `tests/setup.ts` polyfills `IntersectionObserver` for the `inView` gesture. `passWithNoTests: true` so the harness reports green when no tests are written yet.
- **TypeScript `customConditions: ["solid", "development"]`** in the base tsconfig. This makes `tsc` resolve the library through the same `"solid"` export condition Vite does, so type checking against the library works without a build step.
- **`examples/basic` is plain Vite SPA, not SolidStart.** SolidStart is in a 1.x→2.x architecture transition; SSR demos will live in a separate `examples/ssr-test` once SolidStart 2.x stabilizes.

## Common commands

All commands run from the **workspace root**.

```bash
bun install                       # workspace install (single bun.lock at root)
bun run dev                       # start the basic example dev server
bun run build                     # build every package
bun run test                      # vitest run in every package
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

- `bun run test` (always use this) → calls the `package.json` test script → invokes Vitest with our `vite.config.ts` + `vitest.ssr.config.ts`. All 140+ tests pass.
- `bun test` (avoid) → invokes Bun's *built-in* test runner. Our test files use Vitest APIs (`vi.mock`, `vi.fn`, `vi.spyOn`), jsdom env, `@solidjs/testing-library`, and the `vite-plugin-solid` JSX transform — none of which Bun's native runner understands.

The `bunfig.toml` in the repo root re-routes Bun's test root to a placeholder directory, so `bun test` exits cleanly with "0 test files matching" instead of falsely reporting failures from running our files through the wrong runner.

**Verifying a build locally before publishing**: temporarily strip `"development"` and `"solid"` from `examples/basic/vite.config.ts`'s `resolve.conditions`, then run `bun --filter basic dev`. The example will import from `dist/index.js` instead of source. Revert after testing.

## Conventions

- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- **Quotes / semis**: Biome-enforced style — double quotes, no semicolons except where required, trailing commas everywhere.
- **No default exports.** Named exports only.
- **Explicit return types on every exported function.** JSR's "slow types" check requires this; also keeps the public API surface deliberate.
- **JSDoc on every public API** with `@example` blocks. JSR auto-generates docs from these.
- **No CJS.** ESM only.
- **Don't import from `motion/react` or undocumented `motion/dom` paths.** Public surface only: `import { animate, spring, inView, ... } from "motion"`.
- **Solid reactivity discipline**: `createEffect` for side effects, never `createMemo` for side effects. `onMount` for one-time setup, `onCleanup` for teardown. Never destructure props at the top of a function (use `splitProps`).
- **Solid-native bridges**: expose motion values, scroll progress, etc. as Solid signals via `from()` from `solid-js`. Prefer signals over manual subscriptions when Solid offers the better primitive.

## Identity-sensitive places to update together

When changing the library's name, scope, or repo, these all have to move in lockstep:

- `packages/motion/package.json` — `name`, `repository.url`, `repository.directory`, `bugs.url`, `homepage`
- `packages/motion/jsr.json` — `name`
- `examples/basic/package.json` — workspace dep name (`"solidjs-motion": "workspace:*"`)
- `examples/basic/src/main.tsx` — `import` specifier
- `LICENSE` and `packages/motion/LICENSE` — copyright holder line
- `README.md` and `packages/motion/README.md` — install commands, install instructions
