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
// `<Router base>` is intentionally absent here — SolidStart's static
// preset uses `server.baseURL` from `app.config.ts` to prefix the
// generated HTML's <link>/<script> tags and to namespace the prerender
// output. Solid Router on the client uses the same effective base because
// the entry script ran from the prefixed URL, so navigation is consistent.
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <Router
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
