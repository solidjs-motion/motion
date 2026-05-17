# Why this directory exists

This is a placeholder root for Bun's built-in test runner (`bun test`),
configured in `../bunfig.toml`.

Every test file in this repo is authored for **Vitest**, not Bun's native
runner. They use Vitest APIs (`vi.mock`, `vi.fn`, `vi.spyOn`), the jsdom
environment, `@solidjs/testing-library`, the vite-plugin-solid JSX transform,
and the project's `vite.config.ts` / `vitest.ssr.config.ts` plumbing — none
of which Bun's native runner understands.

If `bun test` auto-discovered our `.test.tsx` files, it would default to
React JSX and fail with confusing errors. Pointing the `[test]` root here
instead makes `bun test` exit cleanly with no tests found.

**Run the test suite via:**

```bash
bun run test         # browser tests + SSR tests
bun run test:ssr     # SSR config only
bun --filter solidjs-motion test
```

See `CLAUDE.md` for the full command reference.
