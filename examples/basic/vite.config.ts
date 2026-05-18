import { copyFileSync, existsSync } from "node:fs"
import path from "node:path"
import { defineConfig, type Plugin } from "vite"
import solid from "vite-plugin-solid"

// ---------------------------------------------------------------------------
// Base path is taken from DEPLOY_BASE at build time. The GitHub Pages
// workflow sets it to "/motion/" (repo is solidjs-motion/motion → served at
// https://solidjs-motion.github.io/motion/). Local dev leaves it unset, so
// dev/preview run at "/" with no surprises.
//
// `copy404` is a tiny plugin that runs after the closeBundle hook and copies
// dist/index.html → dist/404.html. GitHub Pages serves 404.html on any path
// it doesn't recognize; since the SPA router handles all paths client-side,
// this turns Pages' 404 fallback into a SPA bootstrap and unbreaks deep
// links (e.g. /motion/drag would 404 without it).
// ---------------------------------------------------------------------------

function copy404(): Plugin {
  return {
    name: "copy-index-to-404",
    apply: "build",
    closeBundle() {
      const dist = path.resolve(__dirname, "dist")
      const index = path.join(dist, "index.html")
      const fallback = path.join(dist, "404.html")
      if (existsSync(index)) copyFileSync(index, fallback)
    },
  }
}

export default defineConfig({
  base: process.env.DEPLOY_BASE ?? "/",
  plugins: [solid(), copy404()],
  resolve: {
    conditions: ["development", "browser", "solid"],
  },
})
