import { createSignal, Show } from "solid-js"
import { Presence, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// PresenceModalDialog — overlay + dialog using a SHARED-VOCABULARY pattern.
//
// Both the backdrop and the dialog are direct Presence children (siblings —
// each registers its own runExit). Instead of repeating literal target
// objects, each child uses the SAME label set — `"closed"` / `"open"` —
// and maps its own visual to those labels. A second variant, `"dropped"`,
// is an alternate exit target the user can swap to from the toggle below;
// since `runExit` re-reads opts at exit time, switching the exit label
// mid-life takes effect on the NEXT close.
//
// Why this isn't a parent-cascade orchestration: when Show flips false,
// Solid disposes each child's owner before transition-group fires onExit,
// so a parent's exit label can't reach the children's state machines.
// Each Presence direct child therefore needs its OWN `exit` prop.
// Sharing the label vocabulary is the practical version of orchestration
// once Presence is in the picture.
// ---------------------------------------------------------------------------

type ExitStyle = "fade" | "drop"

export default function PresenceModalDialog() {
  const [open, setOpen] = createSignal(false)
  const [confirmed, setConfirmed] = createSignal<string | null>(null)
  const [exitStyle, setExitStyle] = createSignal<ExitStyle>("fade")
  // The exit label is reactive — flipping `exitStyle` between modes
  // changes which variant the children resolve when they unmount.
  const exitLabel = () => (exitStyle() === "drop" ? "dropped" : "closed")

  const confirm = () => {
    setConfirmed(`Yes — committed at ${new Date().toLocaleTimeString()}`)
    setOpen(false)
  }
  const cancel = () => {
    setConfirmed("Cancelled")
    setOpen(false)
  }

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Open the modal — backdrop and dialog share the <code>"open"</code> /{" "}
        <code>"closed"</code> / <code>"dropped"</code> label vocabulary. Toggling exit style
        switches which variant the children resolve when they unmount; the change takes effect
        on the next close because <code>runExit</code> re-reads opts at exit time.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", "margin-bottom": "1rem" }}>
        <button
          type="button"
          class="demo-button"
          onClick={() => {
            setConfirmed(null)
            setOpen(true)
          }}
        >
          delete repository…
        </button>
        <button
          type="button"
          class="demo-button"
          onClick={() => setExitStyle((s) => (s === "fade" ? "drop" : "fade"))}
        >
          exit style: {exitStyle()}
        </button>
      </div>
      <Show when={confirmed()}>
        {(msg) => (
          <div style={{ color: "var(--color-muted)", "font-size": "0.85rem", "margin-bottom": "1rem" }}>
            Last action: <code>{msg()}</code>
          </div>
        )}
      </Show>
      <div
        style={{
          position: "relative",
          "min-height": "260px",
          background: "var(--color-surface)",
          "border-radius": "12px",
          overflow: "hidden",
        }}
      >
        <Presence>
          <Show when={open()}>
            {(_v) => (
              <>
                <Backdrop onClose={cancel} exitLabel={exitLabel} />
                <Dialog onConfirm={confirm} onCancel={cancel} exitLabel={exitLabel} />
              </>
            )}
          </Show>
        </Presence>
      </div>
    </div>
  )
}

function Backdrop(props: { onClose: () => void; exitLabel: () => "closed" | "dropped" }) {
  // useMotion's function form means opts.exit is re-evaluated each time
  // the parent's `exitLabel` signal changes; runExit uses the LATEST value
  // when the user closes the modal.
  const motion = useMotion(() => ({
    initial: "closed",
    animate: "open",
    exit: props.exitLabel(),
    variants: {
      closed: { opacity: 0 },
      open: { opacity: 1 },
      // Same as `closed` for the backdrop — the dialog is the one that
      // distinguishes between fading out and dropping out.
      dropped: { opacity: 0 },
    },
    transition: { duration: 0.2 },
  }))
  return (
    <button
      type="button"
      aria-label="Close dialog"
      {...motion({
        style: {
          position: "absolute",
          inset: 0,
          background: "rgba(0, 0, 0, 0.5)",
          cursor: "pointer",
          border: "none",
          padding: 0,
        },
      })}
      onClick={props.onClose}
    />
  )
}

function Dialog(props: {
  onConfirm: () => void
  onCancel: () => void
  exitLabel: () => "closed" | "dropped"
}) {
  // The motion element here is the actual dialog card — and the centering
  // wrapper around it is a plain non-motion div. Presence walks the subtree
  // from each direct child it sees and fires every nested motion child's
  // runExit in parallel, so this card's exit animates correctly even though
  // it's wrapped by a non-motion positioning div above it.
  const motion = useMotion(() => ({
    initial: "closed",
    animate: "open",
    exit: props.exitLabel(),
    variants: {
      closed: { opacity: 0, scale: 0.9, y: 16 },
      open: { opacity: 1, scale: 1, y: 0 },
      // Alternate exit: the dialog drops out the bottom of the screen
      // and tilts slightly — a different visual reading for the same
      // close action.
      dropped: { opacity: 0, scale: 0.95, y: 220, rotate: 6 },
    },
    transition: { type: "spring", stiffness: 380, damping: 28 },
  }))
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        "pointer-events": "none",
      }}
    >
      <div
        {...motion({
          style: {
            "pointer-events": "auto",
            background: "var(--color-elevated)",
            "border-radius": "12px",
            padding: "1.5rem",
            "max-width": "360px",
            width: "100%",
            margin: "0 1.5rem",
            "box-shadow": "0 20px 50px rgba(0,0,0,0.25)",
          },
        })}
      >
        <h3 style={{ margin: "0 0 0.5rem", "font-size": "1.1rem" }}>
          Delete <code>my-repo</code>?
        </h3>
        <p
          style={{
            color: "var(--color-muted)",
            "font-size": "0.9rem",
            "line-height": 1.4,
            margin: "0 0 1.25rem",
          }}
        >
          This can't be undone. The repository and all of its history will be gone forever.
        </p>
        <div style={{ display: "flex", "justify-content": "flex-end", gap: "0.5rem" }}>
          <button type="button" class="demo-button" onClick={props.onCancel}>
            cancel
          </button>
          <button
            type="button"
            class="demo-button"
            onClick={props.onConfirm}
            style={{
              background: "#dc2626",
              color: "white",
              "border-color": "#dc2626",
            }}
          >
            delete
          </button>
        </div>
      </div>
    </div>
  )
}
