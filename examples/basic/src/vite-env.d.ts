/// <reference types="@solidjs/start/env" />

// Vinxi/Vite's `?raw` query returns the file contents as a string. The
// reference above declares the base `*?raw` shape, but TS misses
// .tsx?raw without the explicit declaration below (the wildcard
// pattern doesn't cover all extension+query combos out of the box).
declare module "*.tsx?raw" {
  const src: string
  export default src
}

declare module "*.ts?raw" {
  const src: string
  export default src
}
