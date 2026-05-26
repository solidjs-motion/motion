import { createSignal, For } from "solid-js"
import { Presence, Reorder } from "solidjs-motion"

// ---------------------------------------------------------------------------
// ReorderWithExit — reorder + Presence-coordinated exit animations.
//
// Items can be added (prepended) and removed (× button) at any time.
// Removed items fade + scale out via `exit`, with `<Presence>` keeping
// them in the DOM long enough for the exit transition to play.
// Survivors FLIP into their new slots in parallel — same layout
// pipeline that drives center-cross reorder.
//
// The <For> sits INSIDE <Presence> so every list mutation (add, remove,
// reorder-via-drag) routes through Presence's keep-alive bookkeeping.
// ---------------------------------------------------------------------------

type Task = { id: string; label: string; tone: string }

let nextId = 5
const INITIAL: Task[] = [
  { id: "t1", label: "Draft proposal", tone: "#a855f7" },
  { id: "t2", label: "Schedule design review", tone: "#22c55e" },
  { id: "t3", label: "Refactor payment flow", tone: "#ef4444" },
  { id: "t4", label: "Write release notes", tone: "#eab308" },
]
const PALETTE = ["#a855f7", "#22c55e", "#ef4444", "#eab308", "#f97316", "#3b82f6"]

export default function ReorderWithExit() {
  const [tasks, setTasks] = createSignal<Task[]>(INITIAL)

  const add = (): void => {
    nextId += 1
    const id = `t${nextId}`
    const tone = PALETTE[nextId % PALETTE.length] as string
    setTasks([{ id, label: `Task ${nextId}`, tone }, ...tasks()])
  }
  const remove = (id: string): void => {
    setTasks(tasks().filter((t) => t.id !== id))
  }

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Drag to reorder, click <code>+ add</code> to prepend a new item, or click <code>×</code> on
        any row to remove it. Removed items fade + scale out via <code>exit</code>; survivors FLIP
        into their new slots in parallel.
      </p>
      <button
        type="button"
        class="demo-button"
        onClick={add}
        data-testid="reorder-with-exit/add"
        style={{ "margin-bottom": "0.75rem" }}
      >
        + add task
      </button>
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
        <Presence exitMethod="keep-index">
          <For each={tasks()}>
            {(task) => (
              <Reorder.Item
                value={task}
                data-testid={`reorder-with-exit/item/${task.id}`}
                // Opacity-only entry/exit. Transform-based variants
                // (scale, x, y) on items that also have `drag` enabled
                // can race with motion-dom's drag transform writer —
                // a known architectural issue queued for a follow-up
                // (see deferred items, post v0.2.0).
                //
                // box-shadow doesn't need an explicit revert in `animate`:
                // gesture-state's originals tracking captures the
                // pre-gesture computed style on first paint and uses
                // that as the revert target when whileDrag deactivates.
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
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
                whileDrag={{
                  cursor: "grabbing",
                  "box-shadow": "0px 6px 18px rgba(0,0,0,0.25)",
                }}
              >
                <span
                  style={{
                    width: "0.6rem",
                    height: "0.6rem",
                    "border-radius": "999px",
                    background: task.tone,
                    "flex-shrink": 0,
                  }}
                />
                <span style={{ flex: 1 }}>{task.label}</span>
                <button
                  type="button"
                  onClick={() => remove(task.id)}
                  aria-label={`Remove ${task.label}`}
                  data-testid={`reorder-with-exit/remove/${task.id}`}
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
            )}
          </For>
        </Presence>
      </Reorder.Group>
    </div>
  )
}
