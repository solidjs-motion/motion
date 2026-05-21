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
// `/motion/foo` rather than the host root. The base comes from
// `__DEPLOY_BASE__`, a compile-time literal injected by `vite.define` in
// `app.config.ts` (`"/motion/"` in production, `"/"` in dev). We can't
// use `import.meta.env.BASE_URL` because Vinxi resolves that to the
// asset-bundle path ("/motion/_build"), not the app's URL prefix.
// ---------------------------------------------------------------------------

const ROUTER_BASE = __DEPLOY_BASE__.replace(/\/$/, "")

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
