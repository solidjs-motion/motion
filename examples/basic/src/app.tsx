import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Suspense } from "solid-js"
import { AppShell } from "./layout/AppShell"

// ---------------------------------------------------------------------------
// SolidStart root component.
//
// `<FileRoutes />` auto-discovers every `src/routes/**` file as a route.
// `<Router root>` wraps every match in AppShell (the shared layout shell
// with sidebar nav + source viewer). The Suspense boundary inside the root
// is required by Solid Router so lazy-loaded route bundles get a clean
// fallback while their JS is loading on the client.
//
// `<Router base>` must reflect the deploy subpath (e.g. `/motion` on GitHub
// Pages) so client-side route matching strips the prefix before comparing
// against `routes/*.tsx`, AND so `<A href="/foo">` resolves to
// `/motion/foo` rather than the host root. SolidStart sets Vite's `base`
// from `server.baseURL` in `app.config.ts`, so `import.meta.env.BASE_URL`
// is the source of truth (`"/motion/"` in production, `"/"` in dev).
// ---------------------------------------------------------------------------

const ROUTER_BASE = import.meta.env.BASE_URL.replace(/\/$/, "")

export default function App() {
  return (
    <Router
      base={ROUTER_BASE}
      root={(props) => (
        <AppShell>
          <Suspense>{props.children}</Suspense>
        </AppShell>
      )}
    >
      <FileRoutes />
    </Router>
  )
}
