import { For, createEffect, createSignal } from "solid-js"
import { createStore } from "solid-js/store";
import { Reorder, createDragControls, motion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// ReorderHandle — drag-handle pattern.
//
// Each row has a `⋮⋮` handle on the left. Drag is initiated by
// pointer-down on the handle, NOT on the row body. Pattern:
//
//   1. `createDragControls()` per row (one instance per item).
//   2. `<Reorder.Item dragListener={false} dragControls={controls}>` —
//      the item disables its own pointer listener and accepts external
//      drag initiation via controls.
//   3. The handle button does `onPointerDown={(e) => controls.start(e)}`.
//
// Why you'd want this: when items contain interactive content
// (checkboxes, edit-in-place text, remove buttons), full-row drag steals
// pointer events from those interactions. The handle scopes drag to a
// dedicated affordance so the rest of the row stays interactive.
// ---------------------------------------------------------------------------

type Task = { id: string; label: string; done: boolean }

const INITIAL: Task[] = [
  { id: "groceries", label: "Pick up groceries", done: false },
  { id: "review", label: "Review PR #142", done: true },
  { id: "stretch", label: "Stretch break", done: false },
  { id: "dishes", label: "Run the dishwasher", done: false },
  { id: "email", label: "Reply to Marc", done: false },
]

export default function ReorderHandle() {
  const [tasks, setTasks] = createStore<Task[]>(INITIAL)

  const toggleDone = (id: string): void => {
    const index = tasks.findIndex(t => t.id === id);
    if (index < 0) return;
    setTasks(index, "done", (done) => !done)
  }
  const remove = (id: string): void => {
    setTasks(tasks.filter((t) => t.id !== id))
  }

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Drag the <code>⋮⋮</code> handle on the left of each row to reorder. The checkbox and remove
        button stay independently clickable — <code>dragListener: false</code> +{" "}
        <code>dragControls</code> scopes drag initiation to the handle.
      </p>
      <Reorder.Group
        values={tasks}
        onReorder={setTasks}
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
        <For each={tasks}>
          {(task) => {
            const controls = createDragControls()
            const [isDraggingThisRow, setIsDraggingThisRow] = createSignal(false)
            // Sync grip's cursor with the row's drag state. Solid's
            // inline-style object evaluates conditionals once at render
            // setup, so a `cursor: isDraggingThisRow() ? ...` literal
            // wouldn't update reactively. A createEffect on the ref is
            // the clean Solid-idiomatic way.
            let gripRef: HTMLButtonElement | undefined
            createEffect(() => {
              if (gripRef !== undefined) {
                gripRef.style.cursor = isDraggingThisRow() ? "grabbing" : "grab"
              }
            })
            return (
              <Reorder.Item
                value={task}
                dragListener={false}
                dragControls={controls}
                data-testid={`reorder-handle/item/${task.id}`}
                style={{
                  padding: "0.5rem 0.75rem",
                  background: "var(--color-elevated)",
                  "border-radius": "8px",
                  border: "1px solid var(--color-border)",
                  "font-family": "ui-monospace, monospace",
                  "font-size": "0.9rem",
                  color: "var(--color-fg)",
                  display: "flex",
                  "align-items": "center",
                  gap: "0.75rem",
                  "user-select": "none",
                }}
                // `animate` defines the resting target so non-transform
                // properties revert cleanly when `whileDrag` deactivates
                // — the variant system's removed-key fallback resolves
                // to `null` for keys not in motion's defaults table
                // (`box-shadow` isn't), and motion's animate treats
                // `null` as no-op, leaving the shadow stuck.
                //
                // Both shadow values use the same 4-component shape
                // (x, y, blur, color — no spread on either side). WAA
                // only interpolates between matching-structure shadow
                // values; mismatched shapes fall back to a discrete
                // mid-animation swap (looks like a hard cut), and
                // `none`/keyword targets can't be interpolated at all.
                animate="animate"
                whileDrag="dragging"
                variants={{
                  "animate": {
                    "box-shadow": "0px 0px 0px rgba(0,0,0,0)"
                  },
                  "dragging": {
                    cursor: "grabbing",
                  "box-shadow": "0px 6px 18px rgba(0,0,0,0.25)",
                  scale: 1.02,
                  }
                }}
                transition={{ duration: 0.3 }}
                // Force a `grabbing` cursor on the whole page during the
                // drag. motion-dom's drag pipeline captures the pointer
                // to the dragged item but doesn't touch document.body's
                // cursor — without this, the cursor reverts to default
                // whenever the pointer moves off the dragged row.
                onDragStart={() => {
                  setIsDraggingThisRow(true)
                  document.body.style.cursor = "grabbing"
                }}
                onDragEnd={() => {
                  setIsDraggingThisRow(false)
                  document.body.style.cursor = ""
                }}
              >
                <motion.button
                  ref={gripRef}
                  type="button"
                  onPointerDown={(e) => controls.start(e)}
                  aria-label={`Drag ${task.label}`}
                  data-testid={`reorder-handle/grip/${task.id}`}
                  variants={{
                    "animate": {
                      color: "var(--color-muted)"
                    },
                    "dragging": {
                      color: "var(--color-motion)"
                    }
                  }}
                  style={{
                    // `cursor` is set imperatively by the createEffect
                    // above so it flips between `grab` and `grabbing`
                    // reactively with the row's drag state.
                    "touch-action": "none",
                    background: "transparent",
                    border: "none",
                    // color: "var(--color-muted)",
                    "font-size": "1rem",
                    padding: "0.25rem",
                    "line-height": 1,
                  }}
                >
                  ⋮⋮
                </motion.button>
                <input
                  type="checkbox"
                  checked={task.done}
                  onChange={() => toggleDone(task.id)}
                  data-testid={`reorder-handle/check/${task.id}`}
                  style={{ cursor: "pointer", margin: 0 }}
                />
                <span
                  style={{
                    flex: 1,
                    "text-decoration": task.done ? "line-through" : "none",
                    color: task.done ? "var(--color-muted)" : "var(--color-fg)",
                  }}
                >
                  {task.label}
                </span>
                <button
                  type="button"
                  onClick={() => remove(task.id)}
                  aria-label={`Remove ${task.label}`}
                  data-testid={`reorder-handle/remove/${task.id}`}
                  style={{
                    cursor: "pointer",
                    background: "transparent",
                    border: "none",
                    color: "var(--color-muted)",
                    "font-size": "1rem",
                    padding: "0.25rem 0.5rem",
                    "line-height": 1,
                  }}
                >
                  ×
                </button>
              </Reorder.Item>
            )
          }}
        </For>
      </Reorder.Group>
    </div>
  )
}
