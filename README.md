#### I'm still working on this project, just really getting down the layout/reorder engine here. The initial implementation is extremely shallow and does NOT cover all motion examples precisely. Framer motion does A LOT under the hood to handle layout based animations, so this will take some time! Thanks for your patience!

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

Current release: **v0.2.0** (pre-1.0). The library covers the canonical
`motion/react` surface — animation primitives, MotionValues, gestures,
drag, variants, `<Presence>`, the `<motion.X>` proxy + HOC, MV-in-style,
layout animations, shared-element transitions (`layoutId`), and
drag-to-reorder.

Deferred to a future minor: SVG path drawing (`<motion.path pathLength>`),
`useAnimate` imperative AnimationControls, `LazyMotion` lazy-loaded
feature bundles.

See [`packages/motion/CHANGELOG.md`](./packages/motion/CHANGELOG.md) for
release history and
[`packages/motion/README.md`](./packages/motion/README.md#roadmap) for
the per-API breakdown.

## License

[MIT](./LICENSE) — copyright the solidjs-motion contributors.
