import { resolve } from "node:path"
import solid from "vite-plugin-solid"
import { defineConfig } from "vitest/config"

// Separate config for `vitest bench`.
//
// vite-plugin-solid only injects the `browser` resolve condition and the
// `jsdom` environment when `mode === "test"`. In bench mode (`vitest bench`),
// the plugin's heuristic mis-routes solid-js (root) through its server build,
// which breaks any bench that touches `createStore` or `useMotion`.
//
// We bypass that heuristic by:
//   1. setting `mode: "test"` here so vite-plugin-solid configures itself
//      identically to the regular test runner;
//   2. pointing the include glob at `bench/**/*.bench.*` instead of the
//      default `**/*.{test,spec}.*` so vitest still treats this as a
//      benchmark run when invoked with `bench --run`.
export default defineConfig({
  plugins: [solid()],
  mode: "test",
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [resolve(import.meta.dirname, "tests/setup.ts")],
    include: ["bench/**/*.bench.{ts,tsx}"],
    benchmark: {
      include: ["bench/**/*.bench.{ts,tsx}"],
    },
    // Force vite to transform solid-js + solid-js/store + solid-js/web
    // through the same resolver pass that picks up our `browser` +
    // `development` conditions. Without this, vite externalizes solid-js
    // (root) and Node's loader picks its `node` exports branch (= server
    // build), while solid-js/web is still transformed and picks the
    // browser build. The split DEV symbol then breaks createStore's
    // `registerGraph` call.
    server: {
      deps: {
        inline: [/solid-js/],
      },
    },
    passWithNoTests: true,
  },
  resolve: {
    conditions: ["development", "browser"],
  },
})
