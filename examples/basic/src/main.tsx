import { Route, Router } from "@solidjs/router"
import { For, lazy } from "solid-js"
import { render } from "solid-js/web"
import { demos } from "./demos/registry"
import { AppShell } from "./layout/AppShell"

// ---------------------------------------------------------------------------
// Router setup — AppShell wraps every route; the index route renders the
// landing page; every other route is registered from the demo registry.
// Routes are lazy-loaded so each demo only pulls its bundle when visited.
// ---------------------------------------------------------------------------

const Landing = lazy(() => import("./demos/Landing"))

function NotFound() {
  return <p style={{ color: "#888" }}>Unknown route — pick something from the sidebar.</p>
}

const root = document.getElementById("root")
if (!root) throw new Error("missing #root")

render(
  () => (
    <Router root={AppShell}>
      <Route path="/" component={Landing} />
      <For each={demos}>{(demo) => <Route path={demo.path} component={demo.component} />}</For>
      <Route path="*" component={NotFound} />
    </Router>
  ),
  root,
)
