import { For } from "solid-js"
import { useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// InViewAndProvider — the inView gesture animates an element into view as it
// scrolls into the viewport. Nested children that don't themselves declare a
// gesture target inherit the parent's variant cascade via `m.Provider`
// (Phase 2 commit 4 — the "controlling variants" rule from motion-dom).
//
// Each Card declares `variants` with `hidden` / `visible` labels. The parent
// node says `initial: "hidden", inView: "visible"`; the nested label inside
// the Provider gets the same active label and resolves it against its OWN
// variants map. That's how a parent's gesture cascades without forcing the
// child to know about the gesture itself.
// ---------------------------------------------------------------------------

export default function InViewAndProvider() {
  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Scroll down. Each card fades in once a small slice intersects the viewport. The label inside
        each card inherits the parent's animate state through <code>m.Provider</code> — no duplicate
        gesture wiring.
      </p>
      <div style={{ display: "grid", gap: "1.5rem" }}>
        <For each={Array.from({ length: 6 })}>{(_, i) => <Card index={i()} />}</For>
      </div>
      <div style={{ height: "30vh" }} />
    </div>
  )
}

function Card(props: { index: number }) {
  // Variant LABELS (strings) make this node "controlling variants" — its
  // descendants inherit the active label and resolve it in their OWN
  // variants map, rather than walking up the tree at lookup time.
  const motion = useMotion({
    initial: "hidden",
    inView: "visible",
    inViewOptions: { amount: 0.3 },
    variants: {
      hidden: { opacity: 0, y: 24 },
      visible: { opacity: 1, y: 0 },
    },
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  })
  return (
    <article
      {...motion({
        style: {
          padding: "1.5rem",
          "border-radius": "12px",
          background: "var(--color-elevated)",
          border: "1px solid var(--color-border)",
          "box-shadow": "0 1px 2px rgba(0,0,0,0.04)",
        },
      })}
    >
      <h3 style={{ margin: "0 0 0.5rem" }}>Card {props.index + 1}</h3>
      <motion.Provider>
        <CardLabel />
      </motion.Provider>
    </article>
  )
}

function CardLabel() {
  // No `inView` prop here — this child is a PASSIVE consumer. Its `variants`
  // map defines what `hidden`/`visible` mean for the label specifically. The
  // parent's active label (`visible`) propagates through and is resolved
  // against this map.
  const motion = useMotion({
    variants: {
      hidden: { opacity: 0, x: -16 },
      visible: { opacity: 1, x: 0 },
    },
    transition: { duration: 0.4, delay: 0.15 },
  })
  return (
    <span
      {...motion({
        style: {
          display: "inline-block",
          padding: "0.25rem 0.5rem",
          background: "#e3f2fd",
          color: "#1565c0",
          "border-radius": "999px",
          "font-size": "0.85rem",
        },
      })}
    >
      inherited via Provider
    </span>
  )
}
