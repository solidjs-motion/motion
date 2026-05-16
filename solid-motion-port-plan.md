# solid-motion — Implementation Plan

## What this is

`solid-motion` is a SolidJS animation library that ports the API surface of `motion/react` (formerly Framer Motion) while taking advantage of Solid-specific primitives. It wraps the framework-agnostic `motion` npm package and exposes a `useMotion` hook as the primary API, with optional component and directive layers as sugar.

**Repository structure:** Turborepo monorepo with the library in `packages/solid-motion` and demo apps in `examples/`. Bun is the package manager and workspace runtime; Vite builds the library; SolidStart powers the example apps.

**Library package names:**
- npm: `solid-motion`
- JSR: `@your-scope/solid-motion` (JSR requires a scope — pick one in Phase 0)

**Goal:** ship a v0.1 covering ~90% of common motion/react usage — declarative animations, exit animations, hover/press/drag/inView gestures, variants — with full SSR support and idiomatic Solid ergonomics. Dual-published to npm and JSR.

**Non-goals for v0.1:**
- Layout / `layoutId` shared-element transitions (projection system). Defer to v0.2+. For shared-element transitions in v0.1, document the View Transitions API via Solid Router as the alternative.
- 3D transforms beyond basic translate/scale/rotate
- SVG path morphing
- Reorder (depends on projection)
- Motion+ features (commercial-tier)

## Architectural decisions (already settled)

These were determined in the design phase. Do not relitigate without strong reason.

### 1. `useMotion` is the primary API, returns a getter function

```tsx
const motionProps = useMotion({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
})

<div {...motionProps({ class: "card" })}>Hello</div>
```

The returned function (`motionProps`) takes optional user props and returns a merged props object. This solves:
- **Style merging** — user's styles deep-merge with motion's initial styles
- **Ref composition** — user's ref and motion's ref both fire (via `mergeRefs`)
- **SSR** — the initial style is computed deterministically and emitted as inline `style` attribute

This pattern matches React Aria's `getRootProps`, Floating UI's `getReferenceProps`, etc. It's well-validated.

### 2. Reactivity opt-in via function form

```tsx
useMotion({ animate: { x: 100 } })                  // static
useMotion(() => ({ animate: { x: x() } }))          // reactive — signals tracked
```

`initial` is captured once at construction. `animate`/`hover`/`press` track signals via the inner `createEffect` inside `createMotion`.

### 3. Three-layer architecture

```
                createMotion(el, opts)               ← imperative primitive
                          ↑
                   useMotion(opts)                   ← returns getProps(userProps?)
                          ↑
            ┌─────────────┴─────────────┐
            ↑                           ↑
       <Motion as="div" />          use:motion={opts}
       (uses getProps)              (uses createMotion directly)
```

`createMotion` is the imperative primitive. `useMotion` is the canonical public API. `<Motion>` and `use:motion` are thin sugar layers built on top.

**Build order:** primitive → useMotion → component → (directive can come later or be skipped for v0.1).

### 4. SSR pattern

- Server: `useMotion` returns `{ style: { opacity: 0, ... }, "data-motion-hydrated": "", ref: ... }`. Style is serialized into HTML.
- Browser: paints with initial style applied (no flicker).
- Hydration: ref runs, `createMotion` sees `initialAppliedBySSR: true`, skips its own initial application, runs `animate()` to the target.

Hydration matching: server and client first-render produce identical style strings because `targetToStyle` is a pure deterministic function.

## Tech stack

- **Monorepo:** Turborepo with Bun workspaces
- **Package manager / runtime / scripts:** Bun
- **Build tool (library):** Vite (library mode) with `vite-plugin-solid` and `vite-plugin-dts`
- **Test runner (library):** Vitest with `@solidjs/testing-library` and `jsdom`
- **Example apps:** SolidStart (Vinxi/Vite + Solid Router)
- **Language:** TypeScript with strict mode, ESM only (no CJS)
- **Framework:** Solid 1.9+ (peerDep on the library)
- **Animation engine:** `motion` npm package
- **Helpers:** `@solid-primitives/refs` for `mergeRefs`
- **Linting/formatting:** Biome at the workspace root (applies to all packages)
- **Publishing:** dual-publish to npm and JSR

## Repository structure

```
solid-motion/                          # repo root
├── package.json                       # workspace root, scripts, devDeps
├── turbo.json                         # task graph + caching
├── biome.json                         # shared lint/format config
├── tsconfig.base.json                 # shared TS config (extended by packages)
├── bun.lockb
├── .gitignore
├── .github/
│   └── workflows/
│       └── publish.yml                # release workflow
├── README.md                          # workspace overview
├── packages/
│   └── solid-motion/                  # the library
│       ├── package.json
│       ├── jsr.json
│       ├── tsconfig.json
│       ├── vite.config.ts             # library build + Vitest config
│       ├── README.md                  # library-specific (npm/JSR readme)
│       ├── CHANGELOG.md
│       ├── LICENSE
│       ├── src/
│       │   ├── index.ts               # Public exports
│       │   ├── types.ts
│       │   ├── style.ts
│       │   ├── primitives/
│       │   │   ├── createMotion.ts
│       │   │   ├── createDrag.ts
│       │   │   ├── createGestures.ts
│       │   │   └── index.ts
│       │   ├── use-motion.ts
│       │   ├── presence.tsx
│       │   ├── variants.ts
│       │   ├── Motion.tsx
│       │   └── directive.ts           # Phase 5 (deferred)
│       └── tests/
│           ├── setup.ts
│           ├── style.test.ts
│           ├── use-motion.test.tsx
│           ├── presence.test.tsx
│           └── ssr.test.tsx
└── examples/
    ├── basic/                         # minimal hello-world fade-in
    ├── showcase/                      # comprehensive feature gallery
    └── ssr-test/                      # SSR-specific verification app
```

`apps/` would be conventional for deployable applications, but these are demonstrations, not production apps, so `examples/` is the more honest name.

## Phase 0 — Monorepo scaffold + library + first example (3-5 hours)

This phase ends with a working monorepo where you can:
- Run `bun run dev` and see the basic example app live-reload against unbuilt library source
- Run `bun run test` to execute the library's test suite (no tests yet)
- Run `bun run build` to produce a publishable library bundle

### Step 1 — Workspace root

```bash
mkdir solid-motion && cd solid-motion
git init
bun init -y .
```

Replace the auto-generated `package.json` with:

```json
{
  "name": "solid-motion-workspace",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "examples/*"],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "lint": "biome check .",
    "format": "biome format --write .",
    "clean": "turbo run clean && rm -rf node_modules",
    "example:basic": "turbo run dev --filter=basic",
    "example:showcase": "turbo run dev --filter=showcase",
    "example:ssr": "turbo run dev --filter=ssr-test"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.6.0",
    "@biomejs/biome": "^1.9.0"
  },
  "packageManager": "bun@1.2.0",
  "engines": { "bun": ">=1.2.0" }
}
```

### Step 2 — Turbo configuration

`turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".output/**", ".vinxi/**"],
      "inputs": ["src/**", "tsconfig.json", "vite.config.ts", "package.json"]
    },
    "dev": {
      "cache": false,
      "persistent": true,
      "dependsOn": ["^build:watch"]
    },
    "build:watch": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"],
      "inputs": ["src/**", "tests/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tests/**", "tsconfig.json"]
    },
    "lint": {},
    "clean": { "cache": false }
  }
}
```

Key behaviors:
- `dependsOn: ["^build"]` on test/typecheck means dependencies build first (e.g., examples can't typecheck until the library is built)
- `dev` is `persistent: true` so it stays running; `cache: false` because dev should always run fresh
- `^build:watch` lets the library run in watch mode while example apps consume it

### Step 3 — Shared TS base config

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "resolveJsonModule": true
  }
}
```

### Step 4 — Biome and gitignore

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "files": {
    "ignore": ["**/dist/**", "**/.output/**", "**/.vinxi/**", "**/node_modules/**"]
  }
}
```

`.gitignore`:

```
node_modules
dist
.output
.vinxi
.turbo
coverage
*.log
.env
.env.local
.DS_Store
```

### Step 5 — Library package (`packages/solid-motion`)

```bash
mkdir -p packages/solid-motion/{src,tests}
cd packages/solid-motion
```

**Pick a JSR scope.** Sign in at https://jsr.io with GitHub, create a scope (e.g., `@your-handle`), and you'll publish as `@your-scope/solid-motion`. Before proceeding, run `npm view solid-motion` to confirm the unscoped npm name is available; if not, fall back to `@your-scope/solid-motion` on npm too.

`packages/solid-motion/package.json`:

```json
{
  "name": "solid-motion",
  "version": "0.1.0",
  "description": "An animation library for SolidJS — port of motion/react patterns",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "solid": "./src/index.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "src", "README.md", "LICENSE"],
  "sideEffects": false,
  "scripts": {
    "build": "vite build",
    "build:watch": "vite build --watch",
    "dev": "vite build --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist .turbo node_modules",
    "publish:npm": "bun run build && npm publish --access public",
    "publish:jsr": "bunx jsr publish"
  },
  "peerDependencies": {
    "solid-js": "^1.9.0",
    "motion": "^12.0.0"
  },
  "dependencies": {
    "@solid-primitives/refs": "^1.1.0"
  },
  "devDependencies": {
    "solid-js": "^1.9.0",
    "motion": "^12.0.0",
    "vite": "^5.4.0",
    "vite-plugin-solid": "^2.10.0",
    "vite-plugin-dts": "^4.0.0",
    "vitest": "^2.0.0",
    "@solidjs/testing-library": "^0.8.0",
    "@testing-library/jest-dom": "^6.5.0",
    "jsdom": "^25.0.0"
  },
  "keywords": ["solid", "solidjs", "animation", "motion", "framer-motion", "spring", "transition"],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/your-handle/solid-motion.git",
    "directory": "packages/solid-motion"
  },
  "license": "MIT"
}
```

`packages/solid-motion/jsr.json`:

```json
{
  "name": "@your-scope/solid-motion",
  "version": "0.1.0",
  "license": "MIT",
  "exports": "./src/index.ts",
  "publish": {
    "include": ["src", "README.md", "LICENSE", "jsr.json"],
    "exclude": ["**/*.test.ts", "**/*.test.tsx", "tests/"]
  },
  "imports": {
    "solid-js": "npm:solid-js@^1.9.0",
    "solid-js/web": "npm:solid-js@^1.9.0/web",
    "motion": "npm:motion@^12.0.0",
    "@solid-primitives/refs": "npm:@solid-primitives/refs@^1.1.0"
  }
}
```

`packages/solid-motion/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "declaration": true,
    "outDir": "./dist"
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

`packages/solid-motion/vite.config.ts`:

```ts
/// <reference types="vitest" />
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import dts from "vite-plugin-dts"
import { resolve } from "node:path"

export default defineConfig({
  plugins: [
    solid(),
    dts({
      include: ["src"],
      outDir: "dist",
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: [
        "solid-js",
        "solid-js/web",
        "solid-js/store",
        "motion",
        "@solid-primitives/refs",
      ],
    },
    target: "es2022",
    sourcemap: true,
    minify: false,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    deps: { optimizer: { web: { include: ["solid-js"] } } },
  },
  resolve: {
    conditions: ["development", "browser"],
  },
})
```

`packages/solid-motion/tests/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest"
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
  root = null
  rootMargin = ""
  thresholds = []
}
;(globalThis as any).IntersectionObserver ??= MockIntersectionObserver
```

`packages/solid-motion/src/index.ts` (placeholder):

```ts
export const placeholder = true
```

### Step 6 — First example app (`examples/basic`)

```bash
cd ../../examples
bun create solid-app@latest basic
```

When prompted, choose: TypeScript, with SolidStart, basic template.

After scaffold, edit `examples/basic/package.json` to use the library via workspace protocol and clean up scripts:

```json
{
  "name": "basic",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vinxi dev",
    "build": "vinxi build",
    "start": "vinxi start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "solid-motion": "workspace:*",
    "motion": "^12.0.0",
    "@solidjs/start": "^1.0.0",
    "@solidjs/router": "^0.14.0",
    "solid-js": "^1.9.0",
    "vinxi": "^0.4.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

`workspace:*` is the Bun workspace protocol — Bun resolves this to the local `packages/solid-motion`. When you change library source, the example picks it up (thanks to the `"solid"` export condition, which points to unbuilt source).

`examples/basic/app.config.ts`:

```ts
import { defineConfig } from "@solidjs/start/config"

export default defineConfig({
  ssr: true,
  vite: {
    resolve: {
      // The "solid" condition picks up our library's src/ directly,
      // giving us HMR through the library during development
      conditions: ["development", "browser", "solid"],
    },
  },
})
```

`examples/basic/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["vinxi/types/server", "vinxi/types/client"]
  },
  "include": ["src", "app.config.ts"]
}
```

`examples/basic/src/routes/index.tsx` — a minimal placeholder until Phase 1 lands:

```tsx
// Will import useMotion once Phase 1 lands
// import { useMotion } from "solid-motion"

export default function Home() {
  return (
    <main style={{ padding: "2rem", "font-family": "system-ui" }}>
      <h1>solid-motion: basic example</h1>
      <p>Placeholder. Will demonstrate useMotion once Phase 1 lands.</p>
    </main>
  )
}
```

### Step 7 — Install + verify

From the repo root:

```bash
bun install
bun run build       # turbo builds packages/solid-motion (empty placeholder)
bun run typecheck   # passes
bun run test        # no tests yet, passes
bun run example:basic   # starts SolidStart dev server for examples/basic
```

Open the printed localhost URL; you should see the placeholder page.

### Acceptance

- `bun install` succeeds and produces a single root `bun.lockb`
- `bun run build` builds the library; `dist/index.js` and `dist/index.d.ts` exist
- `bun run example:basic` serves the demo with HMR
- Editing `packages/solid-motion/src/index.ts` triggers a refresh in the example app (because of the `"solid"` export condition)
- `bun run typecheck` and `bun run test` pass

## Phase 1 — Core: `targetToStyle` + `createMotion` + `useMotion` (3-5 days)

All file paths in this phase are relative to `packages/solid-motion/`.

### 1.1 — `src/types.ts`

```ts
import type { JSX } from "solid-js"
import type { AnimationOptions } from "motion"

export type Target = Record<string, string | number | Array<string | number>>

export type Variants = Record<string, Target>

export type MotionOptions = {
  initial?: Target | string | false
  animate?: Target | string
  exit?: Target | string
  transition?: AnimationOptions
  hover?: Target | string
  press?: Target | string
  inView?: Target | string
  inViewOptions?: IntersectionObserverInit
  drag?: boolean | "x" | "y" | DragOptions
  variants?: Variants
}

export type DragOptions = {
  axis?: "x" | "y" | "both"
  constraints?: { left?: number; right?: number; top?: number; bottom?: number }
  elastic?: number
  momentum?: boolean
  onDragStart?: (e: PointerEvent) => void
  onDragEnd?: (info: { offset: { x: number; y: number }; velocity: { x: number; y: number } }) => void
}

export type ElementProps = JSX.HTMLAttributes<HTMLElement> & {
  ref?: ((el: HTMLElement) => void) | HTMLElement | undefined
  style?: JSX.CSSProperties
}

export type MotionMergedProps<P extends ElementProps> = P & {
  style: JSX.CSSProperties
  ref: (el: HTMLElement) => void
  "data-motion-hydrated"?: ""
}
```

### 1.2 — `src/style.ts`

Pure function — no side effects, no DOM access. Must be deterministic for SSR.

Behaviors:
- Transform-like keys (`x`, `y`, `z`, `scale`, `scaleX/Y`, `rotate`, `rotateX/Y/Z`, `skewX/Y`) compose into a single `transform: ...` string.
- Number values for `x/y/z` get `px`. Rotation/skew get `deg`.
- Array values (keyframes) → take the first frame as the static start.
- Properties with implicit `px` units (`width`, `height`, `borderRadius`, `padding`, `margin`, etc.) — maintain a Set, apply `px` suffix to number values.
- Colors and string values pass through unchanged.
- Unknown keys pass through as-is.

Reference: `motion`'s `value-types` module has a similar converter — don't import it (not public API), reimplement.

Test cases:
- `{ opacity: 0.5 }` → `{ opacity: 0.5 }`
- `{ x: 100 }` → `{ transform: "translateX(100px)" }`
- `{ x: 100, y: 50, scale: 0.9 }` → single composed `transform` string
- `{ rotate: 45 }` → `{ transform: "rotate(45deg)" }`
- `{ width: 100, opacity: [0, 1] }` → `{ width: "100px", opacity: 0 }`
- `{ backgroundColor: "red" }` → `{ backgroundColor: "red" }`
- `{}` → `{}`

### 1.3 — `src/primitives/createMotion.ts`

```ts
export function createMotion(
  el: HTMLElement,
  getOpts: () => MotionOptions,
  config?: { initialAppliedBySSR?: boolean },
): void
```

Behavior:
1. `onMount`: if `!config?.initialAppliedBySSR && getOpts().initial !== false`, apply initial styles via `applyStaticStyle(el, initial ?? animate)`.
2. `createEffect` reads `getOpts().animate` + variants/transition, calls `animate(el, target, transition)`. Tracks signals via the user-provided function.
3. First-run guard: if `initial === false`, skip the first `createEffect` run.
4. Call `createGestures(el, getOpts)` (Phase 2).
5. Call `createDrag(el, getOpts)` (Phase 2).
6. Presence registration (Phase 3): if `usePresence()` context exists and `exit` is defined, register element + exit target.
7. `onCleanup`: tear down listeners, observers, etc.

### 1.4 — `src/use-motion.ts`

```ts
import { mergeRefs } from "@solid-primitives/refs"
import { createMotion } from "./primitives/createMotion"
import { targetToStyle } from "./style"
import type { MotionOptions, ElementProps, MotionMergedProps, Target, Variants } from "./types"

export function useMotion(
  opts: MotionOptions | (() => MotionOptions),
): <P extends ElementProps>(userProps?: P) => MotionMergedProps<P> {
  const getOpts = typeof opts === "function" ? opts : () => opts

  const snapshot = getOpts()
  const initialTarget =
    snapshot.initial === false
      ? null
      : resolveTarget(snapshot.initial ?? snapshot.animate, snapshot.variants)
  const initialStyle = initialTarget ? targetToStyle(initialTarget) : null

  const motionRef = (el: HTMLElement) => {
    createMotion(el, getOpts, { initialAppliedBySSR: !!initialStyle })
  }

  return function getProps(userProps) {
    return {
      ...(userProps ?? {}),
      style: { ...(userProps?.style ?? {}), ...(initialStyle ?? {}) },
      ref: mergeRefs(userProps?.ref, motionRef),
      "data-motion-hydrated": initialStyle ? "" : undefined,
    } as any
  }
}

function resolveTarget(
  v: Target | string | undefined,
  variants?: Variants,
): Target | null {
  if (!v) return null
  if (typeof v === "string") return variants?.[v] ?? null
  return v
}
```

### 1.5 — Update `src/index.ts`

```ts
export { useMotion } from "./use-motion"
export type * from "./types"
```

### 1.6 — Tests

```ts
// packages/solid-motion/tests/use-motion.test.tsx
import { describe, expect, it } from "vitest"
import { render } from "@solidjs/testing-library"
import { useMotion } from "../src/use-motion"

describe("useMotion", () => {
  it("produces expected initial style", () => {
    const getProps = useMotion({ initial: { opacity: 0, y: 20 } })
    const result = getProps()
    expect(result.style).toEqual({ opacity: 0, transform: "translateY(20px)" })
    expect(result["data-motion-hydrated"]).toBe("")
  })

  it("merges user styles with motion's initial style", () => {
    const getProps = useMotion({ initial: { opacity: 0 } })
    const result = getProps({ style: { padding: "1rem", color: "red" } })
    expect(result.style).toMatchObject({ padding: "1rem", color: "red", opacity: 0 })
  })

  // Add: ref composition, initial:false, SSR determinism, reactive animate
})
```

### 1.7 — Verify in the basic example

Update `examples/basic/src/routes/index.tsx`:

```tsx
import { useMotion } from "solid-motion"

export default function Home() {
  const motionProps = useMotion({
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6 },
  })

  return (
    <main style={{ padding: "2rem", "font-family": "system-ui" }}>
      <h1 {...motionProps()}>solid-motion: basic example</h1>
    </main>
  )
}
```

`bun run example:basic` should now show a heading fading in from 20px below. View the page source on initial load — the `<h1>` should have inline `style="opacity: 0; transform: translateY(20px)"`. After hydration the animation plays. No flicker.

### Acceptance

- All Phase 1 tests pass
- Basic example shows fade-in with correct SSR HTML (verify via "View Source" — initial style should be inlined)
- The library exports compile cleanly via `bun run build`

## Phase 2 — Gestures (1-2 weeks)

### 2.1 — `src/primitives/createGestures.ts`

Handles `hover`, `press`, `inView`.

```ts
export function createGestures(
  el: HTMLElement,
  getOpts: () => MotionOptions,
): void
```

- Internal state `{ hover: false, press: false, inView: false }` as a Solid `createStore`.
- `createMemo` for the resolved target: press > hover > inView > animate.
- `createEffect` watches the memo, calls `animate(el, target, opts.transition)`.
- Event wiring: `pointerenter`/`pointerleave` for hover, `pointerdown`/`pointerup` for press, `IntersectionObserver` for inView with `opts.inViewOptions ?? { threshold: 0.5 }`.
- `onCleanup`: remove listeners, disconnect observer.

### 2.2 — `src/primitives/createDrag.ts`

```ts
export function createDrag(
  el: HTMLElement,
  getOpts: () => MotionOptions,
): void
```

Behavior:
- If `opts.drag` is falsy/undefined, no-op.
- Pointer event listeners drive `translate3d(x, y, 0)` transform.
- Constraints: clamp to `opts.drag.constraints`. Elastic resistance (default 0.5) past boundaries.
- Momentum: on pointer up, spring animate to clamped position using release velocity.
- Track velocity over a 200ms sliding window.
- `el.setPointerCapture(e.pointerId)` on down.
- Axis lock for `"x"` or `"y"`.
- Call `opts.drag.onDragStart` / `onDragEnd` hooks.

Subtle bits:
- Read element's existing transform on pointer-down for starting offset — via `getComputedStyle(el).transform` and matrix parse, OR track motion's last-set position via closure (cleaner).
- Disable text selection during drag (`document.body.style.userSelect = "none"`, restore on up).
- `el.style.touchAction = opts.drag === "x" ? "pan-y" : opts.drag === "y" ? "pan-x" : "none"`.

### 2.3 — Wire into `createMotion`

After basic animate effect: `createGestures(el, getOpts)` and `createDrag(el, getOpts)`. Both no-op when their options aren't set.

### 2.4 — Add `examples/showcase`

```bash
cd examples
bun create solid-app@latest showcase
```

Same SolidStart setup as `basic`, with the same `app.config.ts` `"solid"` condition and `workspace:*` dependency on `solid-motion`.

Add routes:
- `/hover` — hover-scale button
- `/press` — press-and-hold reactive shape
- `/drag` — draggable card with constraints
- `/in-view` — scroll-triggered animation

Showcase becomes the manual-test surface as features land.

### Acceptance

- Phase 2 unit tests pass
- Showcase example demonstrates each gesture
- Drag feels physically right (try elastic boundaries, throw with momentum)

## Phase 3 — Variants and Presence (1 week)

### 3.1 — `src/variants.ts`

```ts
import { createContext, useContext, type Accessor } from "solid-js"
import type { Variants } from "./types"

type VariantContextValue = {
  variants: Accessor<Variants | undefined>
  current: Accessor<string | string[] | undefined>
}

export const VariantContext = createContext<VariantContextValue>()
export const useVariants = () => useContext(VariantContext)
```

Update `useMotion` and `createMotion` to consult this context when resolving string variant names.

### 3.2 — `src/presence.tsx`

```ts
type PresenceContextValue = {
  register: (el: HTMLElement, exit: Target, transition?: AnimationOptions) => void
  unregister: (el: HTMLElement) => void
  beforeUnmount: (el: HTMLElement) => Promise<void>
}

export const PresenceContext = createContext<PresenceContextValue>()
export const usePresence = () => useContext(PresenceContext)

export function Presence(props: {
  children: JSX.Element
  exitBeforeEnter?: boolean
  onExitComplete?: () => void
}) {
  // ...
}
```

The trick: intercept Solid's cleanup so exit animations have time to play. **Study `solid-motionone`'s `presence.tsx`** for the cleanup-interception pattern — this is the trickiest part of the library.

### 3.3 — Tests + showcase additions

Add to showcase:
- `/modal` — modal that slides in with backdrop fade, slides out + fades, then unmounts
- `/list` — animated list with add/remove

### Acceptance

- Phase 3 unit tests pass
- Modal in showcase demonstrates clean enter/exit
- List item add/remove with exit animations works (no clipping, no jumps)

## Phase 4 — `<Motion>` component (1-2 days)

```tsx
// packages/solid-motion/src/Motion.tsx
import { Dynamic } from "solid-js/web"
import { splitProps, type ValidComponent, type ComponentProps } from "solid-js"
import { useMotion } from "./use-motion"
import type { MotionOptions } from "./types"

const MOTION_KEYS = [
  "as", "initial", "animate", "exit", "transition",
  "hover", "press", "inView", "inViewOptions",
  "drag", "variants",
] as const

export function Motion<T extends ValidComponent = "div">(
  props: { as?: T } & MotionOptions & ComponentProps<T>,
) {
  const [m, rest] = splitProps(props as any, MOTION_KEYS)
  const getProps = useMotion(m)
  return <Dynamic component={m.as ?? "div"} {...getProps(rest)} />
}
```

Tests: `<Motion as="button">` renders correctly; `<Motion as={SomeComponent}>` works polymorphically; spread props survive.

Export from `src/index.ts`. Showcase: add a route demonstrating the component API alongside the hook API.

## Phase 5 — `use:motion` directive (deferred / optional)

Skip for v0.1. When added, ~20 lines:

```ts
// packages/solid-motion/src/directive.ts
import { createMotion } from "./primitives/createMotion"
import type { MotionOptions } from "./types"

export function motion(el: HTMLElement, accessor: () => MotionOptions) {
  const initialAppliedBySSR = el.hasAttribute("data-motion-hydrated")
  createMotion(el, accessor, { initialAppliedBySSR })
}

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      motion: MotionOptions
    }
  }
}
```

Provide `motionInitial(target)` as a re-export of `targetToStyle` for directive users who want SSR.

## Phase 6 — SSR example, docs, polish (1 week)

### 6.1 — `examples/ssr-test`

A SolidStart app specifically built to verify SSR. Routes:
- `/fade` — basic fade-in
- `/modal` — modal that's open on SSR (`initial` state in HTML from the start)
- `/list` — staggered list reveal
- `/conditional` — `<Show>` with motion children

This is the SSR canary. If something breaks SSR mid-development, this example fails visibly. Test by viewing page source for each route — initial styles must be inline. Lighthouse/CLS scores should be near-zero (no layout shift from animations).

### 6.2 — Library tests

- Full SSR via `renderToString` from `solid-js/web`, assert HTML contains expected inline styles
- Hydration test: server-render, hydrate, assert no console warnings
- Reduced-motion: respect `prefers-reduced-motion: reduce` — snap to target without animating

### 6.3 — Docs

`packages/solid-motion/README.md` — the npm/JSR readme. Cover:
- Install (`bun add solid-motion` / `bunx jsr add @your-scope/solid-motion`)
- 30-second first example
- API reference: `useMotion`, `<Motion>`, `<Presence>`, `<VariantProvider>`
- Migration guide from `motion/react`
- SSR notes
- Known limitations
- **JSDoc on every public API** — JSR auto-generates docs from these

Root `README.md` — repo overview:
- Workspace structure
- How to run each example
- Contributing notes
- Link to library readme

### 6.4 — CHANGELOG

Keep-a-Changelog format. Each release section: Added / Changed / Fixed / Removed.

### Acceptance

- All tests pass, 80%+ coverage on `packages/solid-motion/src/`
- All three example apps run in dev and build for production
- README has installable examples for both npm and JSR
- No console warnings in any example
- Bundle size under 15kb minified (before gzip) — check with `bunx vite-bundle-visualizer` or similar
- Tree-shakeable — importing only `useMotion` shouldn't pull in drag/presence

## Publishing

Publishing is done from `packages/solid-motion/`, not the workspace root.

### Pre-publish checklist
- [ ] Version bumped in both `packages/solid-motion/package.json` and `jsr.json` (keep in sync)
- [ ] CHANGELOG entry written
- [ ] All tests pass: `bun run test`
- [ ] Build succeeds: `bun run build`
- [ ] Examples still work against the built output (see "Testing the built output" below)
- [ ] Git tag matches version

### npm publish

```bash
cd packages/solid-motion
bun run build
npm publish --access public
```

First-time: `npm login` to authenticate. `--access public` is required for scoped packages on free accounts.

### JSR publish

```bash
cd packages/solid-motion
bunx jsr publish
```

JSR runs quality checks. The "slow types" check is the one that bites people — fix by adding explicit return types on exported functions:

```ts
// ❌ JSR may flag — inferred return type
export function useMotion(opts) { ... }

// ✅ Explicit return type
export function useMotion(
  opts: MotionOptions | (() => MotionOptions),
): <P extends ElementProps>(userProps?: P) => MotionMergedProps<P> {
  ...
}
```

### Testing the built output before publish

During development, examples consume the unbuilt source via the `"solid"` export condition. Before publishing, verify the built output works the same way. Temporary edit in `examples/basic/app.config.ts`:

```ts
resolve: {
  conditions: ["browser"],   // strip "development" and "solid"
}
```

Run `bun run example:basic`. The example now imports from `dist/index.js`. If it works identically, the build is good. Revert the change after testing.

### Automated release (GitHub Action)

`.github/workflows/publish.yml`:

```yaml
name: Publish
on:
  push:
    tags: ["v*"]
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write              # required for JSR OIDC
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run test
      - run: bun run build
      - name: Publish to npm
        working-directory: packages/solid-motion
        run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - name: Publish to JSR
        working-directory: packages/solid-motion
        run: bunx jsr publish
```

JSR's OIDC integration with GitHub Actions means you don't store a JSR token — JSR trusts the GitHub-provided OIDC claim after you link the repo to your JSR scope.

## Conventions and tips

### Code style
- TypeScript strict mode with `noUncheckedIndexedAccess`
- Prefer `type` over `interface` for the public API
- **Explicit return types on all exported functions** (helps JSR's slow-types check)
- Don't export internals — only public APIs from `src/index.ts`
- No default exports (named exports only)
- JSDoc on every public API with `@example` blocks

### Solid-specific
- `createEffect` for reactive side effects, never `createMemo` for side effects
- `onMount` for one-time setup, `onCleanup` for teardown
- `mergeProps` and `splitProps` for prop manipulation
- Don't destructure props at the top of a function — breaks reactivity. Use `splitProps`.

### Monorepo-specific
- Workspace imports use `workspace:*` — examples reference the library by name, not relative path
- The `"solid"` export condition gives examples HMR through library source during dev
- Turbo's `dependsOn: ["^build"]` ensures correct task ordering — don't override unless necessary
- Run `bunx turbo run build --dry` to inspect the task graph if something feels off

### Performance
- Hover/press state should use `createStore`, not multiple signals (one update, one effect run)
- Animate effect should depend only on `animate`/`transition`/variant — not on hover/press state (those go through `createGestures`)
- For drag, write transform directly via `el.style.transform`, not via motion's `animate()` — faster for pointer-driven motion

### What not to depend on
- Don't import from `motion/react` — we're avoiding the React layer
- Don't import from `motion/dom` paths that aren't documented public API
- Use only `import { animate, spring, inView, ... } from "motion"`

### Testing SSR
- Use `renderToString` from `solid-js/web` for SSR unit tests
- Use `hydrate` from `solid-js/web` for hydration tests
- The `examples/ssr-test` app is the integration canary

## Definition of done for v0.1

- [ ] `useMotion` works for basic animate-on-mount with SSR
- [ ] `useMotion` reactive form responds to signal changes
- [ ] `<Motion as="...">` renders any element/component
- [ ] `<Presence>` plays exit animations on unmount
- [ ] Hover, press, inView gestures animate target states
- [ ] Drag with constraints, elastic resistance, momentum
- [ ] Variants resolve by name through context
- [ ] All library tests pass, 80%+ coverage
- [ ] Three example apps work: `basic`, `showcase`, `ssr-test`
- [ ] README has installable examples for both npm and JSR
- [ ] No console warnings on hydration in any example
- [ ] Bundle size under 15kb minified (before gzip)
- [ ] Tree-shakeable
- [ ] Published to both npm and JSR with matching versions
- [ ] GitHub Action for automated release works on tag push

## Things explicitly deferred to v0.2

- Layout animations (`layout` prop)
- `layoutId` shared-element transitions
- Reorder component
- SVG path drawing
- Scroll-linked animations
- AnimationControls / `useAnimate` imperative equivalents
- Lazy loading (`LazyMotion` equivalent)

Document as roadmap items in the README.

## References

- Motion (engine): https://motion.dev
- solid-motionone (community port — read its source for `Presence` patterns): https://github.com/solidjs-community/solid-motionone
- React Aria's prop-merging pattern: https://react-spectrum.adobe.com/react-aria/hooks.html
- Solid's `use:` directive: https://docs.solidjs.com/reference/jsx-attributes/use
- Solid's `Dynamic` component: https://docs.solidjs.com/reference/components/dynamic
- `@solid-primitives/refs` (mergeRefs): https://primitives.solidjs.community/package/refs
- Turborepo docs: https://turbo.build/repo/docs
- SolidStart docs: https://start.solidjs.com
- JSR publishing: https://jsr.io/docs/publishing-packages
- JSR slow-types: https://jsr.io/docs/about-slow-types

---

**Start with Phase 0, then Phase 1. Don't skip ahead — the Phase 1 primitives are load-bearing for everything else. Set up the `examples/basic` app in Phase 0 so you have a live test surface from day one; `showcase` and `ssr-test` accrue features as later phases land.**
