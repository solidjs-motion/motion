import { createSignal, For } from "solid-js"
import { motion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// LayoutList — list reorders / inserts / deletes animate "for free" with
// `<motion.li layout>`.
//
// The parent-`MutationObserver` trigger (one MO shared across all
// `layout` siblings via a WeakMap) catches childList mutations as Solid's
// `<For>` reconciles. Each surviving item re-measures, computes a
// parent-relative delta, and FLIPs to its new slot. Inserted items
// baseline (no FLIP). Removed items disappear (use `<Presence>` if you
// want an exit animation alongside).
// ---------------------------------------------------------------------------

type Item = { id: number; label: string }

let nextId = 4
const FIRST_ITEMS: Item[] = [
  { id: 1, label: "first" },
  { id: 2, label: "second" },
  { id: 3, label: "third" },
]

export default function LayoutList() {
  const [items, setItems] = createSignal<Item[]>(FIRST_ITEMS)

  const prepend = (): void => {
    nextId += 1
    setItems([{ id: nextId, label: `item ${nextId}` }, ...items()])
  }
  const append = (): void => {
    nextId += 1
    setItems([...items(), { id: nextId, label: `item ${nextId}` }])
  }
  const removeFirst = (): void => {
    setItems(items().slice(1))
  }
  const shuffle = (): void => {
    setItems([...items()].sort(() => Math.random() - 0.5))
  }

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Reorder / insert / delete. Each <code>&lt;motion.li layout&gt;</code> measures its
        parent-relative position before and after the list mutation, then FLIPs into its new slot.
        Inserted items just appear at their final position (baseline pass).
      </p>
      <div style={{ display: "flex", gap: "0.5rem", "margin-bottom": "1rem", "flex-wrap": "wrap" }}>
        <button type="button" class="demo-button" onClick={prepend}>
          prepend
        </button>
        <button type="button" class="demo-button" onClick={append}>
          append
        </button>
        <button type="button" class="demo-button" onClick={removeFirst}>
          remove first
        </button>
        <button type="button" class="demo-button" onClick={shuffle}>
          shuffle
        </button>
      </div>
      <motion.ul
        data-testid="list/ul"
        style={{
          "list-style": "none",
          padding: "0.75rem",
          margin: 0,
          "border-radius": "12px",
          background: "var(--color-surface)",
          display: "flex",
          "flex-direction": "column",
          gap: "0.5rem",
          "min-height": "80px",
        }}
      >
        <For each={items()}>
          {(item) => (
            <motion.li
              layout
              data-testid={`list/li/${item.id}`}
              style={{
                padding: "0.5rem 0.75rem",
                background: "var(--color-elevated)",
                "border-radius": "8px",
                border: "1px solid var(--color-border)",
                "font-family": "ui-monospace, monospace",
                "font-size": "0.9rem",
                color: "var(--color-fg)",
              }}
            >
              {item.label}{" "}
              <span style={{ color: "var(--color-muted)", "font-size": "0.75rem" }}>
                #{item.id}
              </span>
            </motion.li>
          )}
        </For>
      </motion.ul>
    </div>
  )
}
