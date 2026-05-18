import { A, useLocation } from "@solidjs/router"
import { createMemo, For, type ParentProps, Show } from "solid-js"
import { DemoSource } from "../components/DemoSource"
import { demos } from "../demos/registry"

// ---------------------------------------------------------------------------
// AppShell — sidebar nav on the left, demo content on the right. The nav
// reads from `demos/registry.ts`, grouped by phase. Routing is set up in
// main.tsx; this component only renders chrome + the matched route's output.
// ---------------------------------------------------------------------------

export function AppShell(props: ParentProps) {
  const location = useLocation()
  const grouped = createMemo(() => ({
    phase1: demos.filter((d) => d.phase === 1),
    phase2: demos.filter((d) => d.phase === 2),
  }))
  const activeDemo = createMemo(() => demos.find((d) => d.path === location.pathname))

  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "240px 1fr",
        "min-height": "100vh",
        "font-family": "system-ui, sans-serif",
        color: "#111",
      }}
    >
      <aside
        style={{
          "border-right": "1px solid #eee",
          background: "#fafafa",
          padding: "1.5rem 1rem",
          "overflow-y": "auto",
        }}
      >
        <A
          href="/"
          style={{
            display: "block",
            "font-weight": 700,
            "font-size": "1rem",
            color: "#111",
            "text-decoration": "none",
            "margin-bottom": "1.5rem",
          }}
        >
          solidjs-motion
        </A>
        <NavGroup title="Phase 1" entries={grouped().phase1} />
        <NavGroup title="Phase 2" entries={grouped().phase2} />
      </aside>
      <main style={{ padding: "2.5rem 3rem", "max-width": "880px" }}>
        <Show when={activeDemo()}>
          {(demo) => (
            <header style={{ "margin-bottom": "2rem" }}>
              <h1 style={{ "font-size": "1.75rem", "font-weight": 600, margin: "0 0 0.5rem" }}>
                {demo().title}
              </h1>
              <p style={{ color: "#555", margin: 0 }}>{demo().blurb}</p>
            </header>
          )}
        </Show>
        {props.children}
        <Show when={activeDemo()}>
          {(demo) => <DemoSource source={demo().source} filename={demo().filename} />}
        </Show>
      </main>
    </div>
  )
}

function NavGroup(props: { title: string; entries: typeof demos }) {
  // Active style is driven from `useLocation` rather than an activeClass CSS
  // rule — biome flags the `!important` needed to beat <A>'s inline styles,
  // so we compute the merged style per link here instead.
  const location = useLocation()
  return (
    <nav style={{ "margin-bottom": "1.5rem" }}>
      <div
        style={{
          "font-size": "0.7rem",
          "text-transform": "uppercase",
          "letter-spacing": "0.08em",
          color: "#888",
          "margin-bottom": "0.5rem",
        }}
      >
        {props.title}
      </div>
      <ul style={{ "list-style": "none", padding: 0, margin: 0 }}>
        <For each={props.entries}>
          {(entry) => {
            const isActive = createMemo(() => location.pathname === entry.path)
            return (
              <li style={{ "margin-bottom": "0.25rem" }}>
                <A
                  href={entry.path}
                  end
                  style={{
                    display: "block",
                    padding: "0.4rem 0.6rem",
                    "border-radius": "6px",
                    "text-decoration": "none",
                    "font-size": "0.9rem",
                    background: isActive() ? "#111" : "transparent",
                    color: isActive() ? "white" : "#333",
                  }}
                >
                  {entry.title}
                </A>
              </li>
            )
          }}
        </For>
      </ul>
    </nav>
  )
}
