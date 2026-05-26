import { createSignal, For } from "solid-js"
import { Reorder } from "solidjs-motion"

// ---------------------------------------------------------------------------
// ReorderBasic — drag to reorder a vertical list.
//
// `<Reorder.Group>` owns the controlled list state; each `<Reorder.Item>`
// is a draggable row whose layout participates in the group's FLIP. As
// the user drags a row past a sibling's center, the primitive mutates
// `values()` live (no preview state). Siblings shift into their new
// slots via layout; the dragged row tracks the pointer and snaps to its
// new slot on release via `dragSnapToOrigin`.
//
// No imperative ref work, no manual MV plumbing — the list is its own
// source of truth and the visual order tracks it via layout animation.
// ---------------------------------------------------------------------------

type Item = { id: string; label: string; tone: string }

const INITIAL: Item[] = [
  { id: "tomato", label: "Tomato", tone: "#ef4444" },
  { id: "cucumber", label: "Cucumber", tone: "#22c55e" },
  { id: "onion", label: "Onion", tone: "#a855f7" },
  { id: "pepper", label: "Pepper", tone: "#eab308" },
  { id: "carrot", label: "Carrot", tone: "#f97316" },
]

export default function ReorderBasic() {
  const [items, setItems] = createSignal<Item[]>(INITIAL)

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Drag any row to reorder. Center-cross detection swaps adjacent items live; siblings FLIP
        into their new slots via <code>layout</code>; the dragged row tracks the pointer and snaps
        to its (now-updated) slot on release via <code>dragSnapToOrigin</code>.
      </p>
      <Reorder.Group
        values={items}
        onReorder={setItems}
        data-testid="reorder-basic/group"
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
            <Reorder.Item
              value={item}
              data-testid={`reorder-basic/item/${item.id}`}
              style={{
                padding: "0.6rem 0.75rem",
                background: "var(--color-elevated)",
                "border-radius": "8px",
                border: "1px solid var(--color-border)",
                "font-family": "ui-monospace, monospace",
                "font-size": "0.9rem",
                color: "var(--color-fg)",
                cursor: "grab",
                display: "flex",
                "align-items": "center",
                gap: "0.6rem",
                "user-select": "none",
              }}
              // No `animate` clause needed for the shadow revert —
              // gesture-state's originals tracking captures the row's
              // pre-gesture computed `box-shadow` on first paint (the
              // jsdom/browser-default `""`/`"none"`, normalized to a
              // transparent zero-shadow) and uses that as the revert
              // target when `whileDrag` deactivates. scale reverts to
              // the motion default (1) via the same chain.
              whileDrag={{
                cursor: "grabbing",
                "box-shadow": "0px 6px 18px rgba(0,0,0,0.25)",
                scale: 1.02,
              }}
              transition={{ duration: 0.18 }}
            >
              <span
                style={{
                  width: "0.6rem",
                  height: "0.6rem",
                  "border-radius": "999px",
                  background: item.tone,
                }}
              />
              {item.label}
              <span style={{ color: "var(--color-muted)", "font-size": "0.75rem" }}>
                #{item.id}
              </span>
            </Reorder.Item>
          )}
        </For>
      </Reorder.Group>
    </div>
  )
}
