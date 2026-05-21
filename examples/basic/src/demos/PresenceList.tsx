import { createSignal, For } from "solid-js"
import { Presence, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// PresenceList — exits on a <For> list. Each motion child registers its own
// `runExit`; <Presence> detects the list shape on first resolution and routes
// through createListTransition, which runs all removed-item exits in parallel
// and lets unchanged items survive without re-mounting.
// ---------------------------------------------------------------------------

type Item = { id: number; label: string }

let nextId = 4
const COLORS = ["#ff6b6b", "#feca57", "#48dbfb", "#1dd1a1", "#5f27cd", "#ff9ff3"]
const colorFor = (id: number) => COLORS[id % COLORS.length]

export default function PresenceList() {
  const [items, setItems] = createSignal<Item[]>([
    { id: 1, label: "first" },
    { id: 2, label: "second" },
    { id: 3, label: "third" },
  ])

  const add = () => {
    const id = nextId++
    setItems((xs) => [...xs, { id, label: `item ${id}` }])
  }
  const removeRandom = () => {
    setItems((xs) => {
      if (xs.length === 0) return xs
      const idx = Math.floor(Math.random() * xs.length)
      return xs.filter((_, i) => i !== idx)
    })
  }
  const removeAll = () => setItems([])

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Add, remove, or clear all — each item runs its own enter/exit independently. Removed items
        animate to the right while surviving items stay put.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", "margin-bottom": "1.5rem" }}>
        <button type="button" class="demo-button" onClick={add}>
          add item
        </button>
        <button type="button" class="demo-button" onClick={removeRandom}>
          remove random
        </button>
        <button type="button" class="demo-button" onClick={removeAll}>
          remove all
        </button>
      </div>
      <ul
        style={{
          "list-style": "none",
          padding: "1rem",
          margin: 0,
          "border-radius": "12px",
          background: "var(--color-surface)",
          display: "grid",
          gap: "0.5rem",
          "min-height": "180px",
        }}
      >
        <Presence exitMethod="keep-index">
          <For each={items()}>{(item) => <Row item={item} />}</For>
        </Presence>
      </ul>
    </div>
  )
}

function Row(props: { item: Item }) {
  const motion = useMotion({
    initial: { opacity: 0, x: -24 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 80 },
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
  })
  return (
    <li
      {...motion({
        style: {
          padding: "0.6rem 0.9rem",
          background: "var(--color-elevated)",
          "border-radius": "8px",
          border: "1px solid var(--color-border)",
          "border-left": `4px solid ${colorFor(props.item.id)}`,
          "font-family": "ui-monospace, monospace",
          "font-size": "0.9rem",
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
        },
      })}
    >
      <span>{props.item.label}</span>
      <span style={{ color: "var(--color-muted)", "font-size": "0.75rem" }}>#{props.item.id}</span>
    </li>
  )
}
