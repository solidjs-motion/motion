import { createSignal, For } from "solid-js"
import { Presence, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// PresenceToastQueue — vertical stack of notifications. Each toast occupies
// its own row in a flex-column container and slides in from the right.
// Auto-dismissal after 4s; tap to dismiss early.
//
// `<Presence exitMethod="keep-index">` keeps an exiting toast in its slot
// during the fade so survivors don't reshuffle. The burst handler staggers
// pushes by 120ms so each new toast is visually distinct as it enters.
// ---------------------------------------------------------------------------

type Toast = {
  id: number
  kind: "info" | "success" | "warning" | "error"
  message: string
}

let nextId = 1

const SAMPLES: Array<Omit<Toast, "id">> = [
  { kind: "success", message: "Order placed." },
  { kind: "info", message: "Saved as draft." },
  { kind: "warning", message: "Heads up: stock low." },
  { kind: "error", message: "Couldn't reach the server." },
]

export default function PresenceToastQueue() {
  const [toasts, setToasts] = createSignal<Toast[]>([])

  const push = (toast: Omit<Toast, "id">) => {
    const id = nextId++
    setToasts((xs) => [...xs, { ...toast, id }])
    window.setTimeout(() => {
      setToasts((xs) => xs.filter((t) => t.id !== id))
    }, 4000)
  }
  const dismiss = (id: number) => setToasts((xs) => xs.filter((t) => t.id !== id))
  const clear = () => setToasts([])

  const fireOne = () => {
    const sample = SAMPLES[Math.floor(Math.random() * SAMPLES.length)] ?? SAMPLES[0]
    if (sample) push(sample)
  }
  const fireFour = () => {
    SAMPLES.forEach((sample, i) => {
      window.setTimeout(() => push(sample), i * 120)
    })
  }

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Fire toasts; they slide in from the right and auto-dismiss after 4 seconds (or click any
        toast to dismiss early). Burst is staggered so each toast is visually distinct, and{" "}
        <code>exitMethod="keep-index"</code> keeps the dismissed toast in place while it fades
        instead of shuffling the survivors.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", "margin-bottom": "1.5rem" }}>
        <button type="button" class="demo-button" onClick={fireOne}>
          fire one
        </button>
        <button type="button" class="demo-button" onClick={fireFour}>
          fire four (staggered)
        </button>
        <button type="button" class="demo-button" onClick={clear} disabled={toasts().length === 0}>
          clear all
        </button>
        <span
          style={{
            "align-self": "center",
            "font-family": "ui-monospace, monospace",
            "font-size": "0.8rem",
            color: "var(--color-muted)",
          }}
        >
          {toasts().length} active
        </span>
      </div>
      <div
        style={{
          "min-height": "320px",
          background: "#0f172a",
          "border-radius": "12px",
          padding: "1.25rem",
          display: "grid",
          "grid-template-columns": "1fr",
          "justify-items": "end",
          "align-content": "start",
          "row-gap": "0.6rem",
        }}
      >
        <Presence exitMethod="keep-index">
          <For each={toasts()}>{(toast) => <ToastCard toast={toast} onDismiss={dismiss} />}</For>
        </Presence>
      </div>
    </div>
  )
}

const KIND_STYLES = {
  info: { background: "linear-gradient(135deg, #2193b0, #6dd5ed)", icon: "ⓘ" },
  success: { background: "linear-gradient(135deg, #11998e, #38ef7d)", icon: "✓" },
  warning: { background: "linear-gradient(135deg, #f7971e, #ffd200)", icon: "⚠" },
  error: { background: "linear-gradient(135deg, #ee0979, #ff6a00)", icon: "✕" },
}

function ToastCard(props: { toast: Toast; onDismiss: (id: number) => void }) {
  const motion = useMotion({
    initial: { opacity: 0, x: 80, scale: 0.94 },
    animate: { opacity: 1, x: 0, scale: 1 },
    exit: { opacity: 0, x: 80, scale: 0.94 },
    transition: { type: "spring", stiffness: 360, damping: 30 },
  })
  const palette = KIND_STYLES[props.toast.kind]
  return (
    <button
      type="button"
      {...motion({
        style: {
          width: "320px",
          padding: "0.85rem 1rem",
          "border-radius": "10px",
          background: palette.background,
          color: "white",
          "font-size": "0.9rem",
          "box-shadow": "0 8px 22px rgba(0,0,0,0.35)",
          display: "flex",
          "align-items": "center",
          gap: "0.7rem",
          cursor: "pointer",
          border: "none",
          "text-align": "left",
          font: "inherit",
        },
      })}
      onClick={() => props.onDismiss(props.toast.id)}
    >
      <span style={{ "font-weight": 700, "font-size": "1.1rem" }}>{palette.icon}</span>
      <span style={{ flex: 1 }}>{props.toast.message}</span>
      <span style={{ opacity: 0.6, "font-size": "0.75rem" }}>×</span>
    </button>
  )
}
