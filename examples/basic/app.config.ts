import { defineConfig } from "@solidjs/start/config"

// ---------------------------------------------------------------------------
// SolidStart configuration — replaces the previous Vite SPA setup. Build
// produces a fully static site that can deploy to GitHub Pages (or any
// static host). Every route is prerendered at build time via Nitro's
// `static` preset; the page bundle still hydrates on the client so motion's
// runtime behavior is fully exercised AFTER the SSR'd first paint.
//
// Why static (SSG) rather than per-request SSR:
//   - GitHub Pages serves static files only.
//   - For a demo gallery with no per-user state, SSG renders the same HTML
//     as request-time SSR would. Same `renderToString` codepath, same
//     hydration story — just executed at build time.
//
// `crawlLinks: true` discovers every route by following links from `/`.
// AppShell's sidebar nav lists every demo, so the crawl reaches them all.
// If we ever add a route that isn't linked from the nav, we'll add its
// path to `prerender.routes` explicitly.
//
// The `DEPLOY_BASE` env var is honored exactly like the old Vite setup so
// the GitHub Actions workflow can keep injecting `/motion/` for the Pages
// subpath. Local dev leaves it unset → serves at `/` with no surprises.
// ---------------------------------------------------------------------------

const DEPLOY_BASE = process.env.DEPLOY_BASE ?? "/"

export default defineConfig({
  server: {
    preset: "static",
    baseURL: DEPLOY_BASE,
    prerender: {
      routes: ["/"],
      crawlLinks: true,
      // GitHub Pages 404 fallback: copy the prerendered shell to 404.html
      // so deep links (e.g. /motion/drag) that miss the static manifest
      // still bootstrap into the SPA's client-side router rather than
      // showing Pages' default 404 page.
      failOnError: true,
    },
  },
  vite: {
    resolve: {
      // Mirrors the library's customConditions: pulls solidjs-motion's
      // source (via the `solid` export condition) rather than `dist/`,
      // so edits to the library hot-reload through the example.
      conditions: ["development", "browser", "solid"],
    },
  },
})
