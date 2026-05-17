# solidjs-motion (workspace)

Monorepo for [`solidjs-motion`](./packages/motion) — a SolidJS animation library that ports the
API surface of `motion/react` while taking advantage of Solid primitives. Wraps the
framework-agnostic [`motion`](https://motion.dev) package.

## Workspace layout

```
.
├── packages/
│   └── motion/          # the library — published to npm and JSR
└── examples/
    └── basic/           # Vite SPA — first visual sanity check
```

Future phases will add `examples/showcase` (feature gallery) and `examples/ssr-test`
(SolidStart-based SSR canary).

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

Phase 0 (workspace scaffold). The library is a placeholder; Phase 1 lands the real
`useMotion` primitive.

## License

[MIT](./LICENSE) — copyright the solidjs-motion contributors.
