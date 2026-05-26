# solidjs-motion (workspace)

Monorepo for [`solidjs-motion`](./packages/motion) — a SolidJS animation library that ports the
API surface of `motion/react` while taking advantage of Solid primitives. Wraps the
framework-agnostic [`motion`](https://motion.dev) package.

**Live demos:** [solidjs-motion.github.io/motion](https://solidjs-motion.github.io/motion/) —
every primitive and pattern with its source.

## Workspace layout

```
.
├── packages/
│   └── motion/          # the library — published to npm and JSR
└── examples/
    └── basic/           # routed Vite SPA demo gallery (deployed to Pages)
```

Future phases will add `examples/ssr-test` (SolidStart-based SSR canary).

## Tooling

- **Package manager / runtime**: Bun (workspaces, no Turborepo).
- **Library build**: Vite library mode with `vite-plugin-solid` and `vite-plugin-dts`.
- **Tests**: Vitest with `@solidjs/testing-library` and `jsdom`.
- **Lint / format**: Biome 2.
- **Language**: TypeScript strict mode, ESM only.

## Common commands

```bash
bun install                    # install everything
bun run dev                    # start the basic example (consumes library source via "solid" export condition)
bun run build                  # build every package
bun run test                   # run every package's tests (browser + SSR)
bun run typecheck              # tsc --noEmit in every package
bun run lint                   # biome check .
bun run format                 # biome format --write .
```

> **Use `bun run test`, not `bun test`.** They route to different test runners
> — our tests are authored for Vitest, and Bun's built-in runner doesn't
> understand Vitest APIs. `bunfig.toml` makes `bun test` a clean no-op so it
> can't accidentally report false failures.

To target a single workspace package directly, use Bun's `--filter`:

```bash
bun --filter solidjs-motion test
bun --filter solidjs-motion test:ssr
bun --filter solidjs-motion build
bun --filter basic dev
```

## Status

Targeting **0.2.0**. The v0.1 surface (animation primitives, MotionValues, gestures, drag,
Presence, motion proxy + HOC, MV-in-style) is shipped; v0.2.0 adds layout animations,
shared-element transitions, and drag-to-reorder.

- **Shipped in v0.1.x:** `useMotion`, the full MotionValue family (`createMotionValue`,
  `createTransform`, `createSpring`, `createTime`, `createVelocity`, `createTemplate`),
  scroll + viewport (`createScroll`, `createInView`), gestures (hover / press / focus /
  whileInView), drag with constraints/elastic/momentum, `createPan`, `createDragControls`,
  variants with parent-cascade + controlling-children rule, `<Presence>` +
  `useAnimatePresence`, `<motion.X>` proxy + `motion.create(Component)` HOC, MV-in-style
  (per-element value registry, see
  [ADR 0005](./docs/adr/0005-mv-in-style-value-registry.md)), `<MotionConfig>`,
  `createReducedMotion`, SSR-friendly first paint.
- **New in v0.2.0:** layout animations (`layout`, `layoutId`, `<LayoutGroup>`,
  `layoutScroll`, `layoutRoot`, `layoutAnchor`, `layoutDependency`, `layoutTransition`,
  `onLayoutAnimationStart/Complete`), drag-to-reorder
  (`<Reorder.Group>` / `<Reorder.Item>` / `createReorder`), originals tracking for
  non-transform property reverts, `whileDrag` variant context propagation, Target
  accepting every CSS property via `csstype.PropertiesHyphen`.
- **Deferred to v0.3+:** SVG path drawing (`<motion.path pathLength>`), `useAnimate`
  imperative AnimationControls, `LazyMotion` lazy-loaded feature bundles.

See [`packages/motion/README.md`](./packages/motion/README.md#roadmap) for the per-API breakdown.

## License

[MIT](./LICENSE) — copyright the solidjs-motion contributors.
