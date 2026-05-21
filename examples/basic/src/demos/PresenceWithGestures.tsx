import { createSignal, Show } from "solid-js"
import { Presence, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// PresenceWithGestures — exit composes with the rest of the gesture state
// machine. The card supports `hover`, `press`, and `exit` simultaneously;
// hover/press claim their keys during the visible life of the element, then
// exit takes over when the surrounding <Show> flips and Presence dispatches
// the registered runExit.
//
// Per the priority chain (exit > drag > whileInView > whileFocus > whilePress
// > whileHover > animate > initial), exit's keys always win at unmount. The
// final hover/press values are still in the DOM when exit dispatches, so the
// exit animate plays from those — visually you'll see the press-down state
// recover into the exit target if you click + remove.
// ---------------------------------------------------------------------------

export default function PresenceWithGestures() {
  const [mounted, setMounted] = createSignal(true)

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Hover and press the card to feel the gesture stack, then click "remove" to see the same card
        exit. All four targets (initial / animate / hover / press) compose with the new exit target.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", "margin-bottom": "1.5rem" }}>
        <button type="button" class="demo-button" onClick={() => setMounted((m) => !m)}>
          {mounted() ? "remove" : "add back"}
        </button>
      </div>
      <div
        style={{
          "min-height": "180px",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
        }}
      >
        <Presence>
          <Show when={mounted()}>{(_v) => <GestureCard />}</Show>
        </Presence>
      </div>
    </div>
  )
}

function GestureCard() {
  const motion = useMotion({
    initial: { opacity: 0, y: 16, scale: 0.96 },
    animate: { opacity: 1, y: 0, scale: 1 },
    hover: { scale: 1.06, y: -4 },
    press: { scale: 0.94 },
    exit: { opacity: 0, y: 24, scale: 0.9 },
    transition: { type: "spring", stiffness: 380, damping: 28 },
  })
  return (
    <div
      {...motion({
        style: {
          padding: "1.5rem 2rem",
          "border-radius": "14px",
          background: "linear-gradient(135deg, #ee0979, #ff6a00)",
          color: "white",
          "font-weight": 600,
          "font-size": "1.1rem",
          "box-shadow": "0 12px 28px rgba(0,0,0,0.18)",
          cursor: "pointer",
          "user-select": "none",
        },
      })}
    >
      hover · press · exit
    </div>
  )
}
