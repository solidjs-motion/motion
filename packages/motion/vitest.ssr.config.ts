import solid from "vite-plugin-solid"
import { defineConfig } from "vitest/config"

// Separate config for SSR tests. solid-js/web's `node` condition resolves
// to the server build, where renderToString actually emits HTML (the browser
// build is a no-op). vite-plugin-solid's ssr: true transforms JSX into the
// hyperscript form the server build consumes.
export default defineConfig({
  plugins: [solid({ ssr: true })],
  test: {
    name: "ssr",
    environment: "node",
    include: ["tests/ssr/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
  },
  resolve: {
    conditions: ["development", "node"],
  },
})
