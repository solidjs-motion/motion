import { A } from "@solidjs/router"
import { For } from "solid-js"
import { useMotion } from "solidjs-motion"
import { demos } from "./registry"

// ---------------------------------------------------------------------------
// Landing — the index route. A static FadeIn hero plus a card grid linking
// to every registered demo. Cards animate on hover via the `hover` gesture
// (one of the Phase 2 primitives this example showcases).
// ---------------------------------------------------------------------------

export default function Landing() {
  const heroMotion = useMotion({
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  })
  return (
    <div>
      <h1
        {...heroMotion({
          style: { "font-size": "2rem", "font-weight": 700, margin: "0 0 0.5rem" },
        })}
      >
        solidjs-motion is alive
      </h1>
      <p style={{ color: "#555", margin: "0 0 2rem" }}>
        SolidJS port of motion/react. Pick a demo from the sidebar — or any card below.
      </p>
      <div
        style={{
          display: "grid",
          "grid-template-columns": "repeat(auto-fill, minmax(220px, 1fr))",
          gap: "0.75rem",
        }}
      >
        <For each={demos}>{(demo) => <DemoCard demo={demo} />}</For>
      </div>
    </div>
  )
}

function DemoCard(props: { demo: (typeof demos)[number] }) {
  // The `hover` gesture is the simplest Phase 2 primitive — declaring a
  // target object under the `hover` key adds a state to the gesture state
  // machine that activates on pointerenter and releases on pointerleave.
  const cardMotion = useMotion({
    initial: { y: 0 },
    hover: { y: -2 },
    transition: { type: "spring", stiffness: 400, damping: 28 },
  })
  return (
    <A
      href={props.demo.path}
      style={{ "text-decoration": "none", color: "inherit", display: "block" }}
    >
      <article
        {...cardMotion({
          style: {
            border: "1px solid #eee",
            "border-radius": "10px",
            padding: "1rem",
            background: "white",
            cursor: "pointer",
          },
        })}
      >
        <div
          style={{
            "font-size": "0.7rem",
            "text-transform": "uppercase",
            "letter-spacing": "0.08em",
            color: "#888",
            "margin-bottom": "0.5rem",
          }}
        >
          Phase {props.demo.phase}
        </div>
        <div style={{ "font-weight": 600, "margin-bottom": "0.25rem" }}>{props.demo.title}</div>
        <div style={{ color: "#666", "font-size": "0.85rem", "line-height": 1.4 }}>
          {props.demo.blurb}
        </div>
      </article>
    </A>
  )
}
