import { resolve } from "node:path"
import dts from "vite-plugin-dts"
import solid from "vite-plugin-solid"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [
    solid(),
    dts({
      include: ["src"],
      outDirs: ["dist"],
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: ["solid-js", "solid-js/web", "solid-js/store", "motion", "@solid-primitives/refs"],
    },
    target: "es2022",
    sourcemap: true,
    minify: false,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    passWithNoTests: true,
    // tests/ssr/ runs under vitest.ssr.config.ts (node env + server condition).
    exclude: ["**/node_modules/**", "**/dist/**", "tests/ssr/**"],
    deps: { optimizer: { web: { include: ["solid-js"] } } },
  },
  resolve: {
    conditions: ["development", "browser"],
  },
})
