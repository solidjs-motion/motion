import { render } from "solid-js/web"
import { placeholder } from "solidjs-motion"

function App() {
  return (
    <main style={{ padding: "2rem", "font-family": "system-ui" }}>
      <h1>solidjs-motion — basic example</h1>
      <p>
        Workspace scaffold is alive. Library import resolved via the <code>solid</code> export
        condition: <code>placeholder = {String(placeholder)}</code>.
      </p>
      <p>
        Phase 1 lands the real <code>useMotion</code> primitive — this page will then demonstrate a
        fade-in.
      </p>
    </main>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("missing #root")
render(() => <App />, root)
