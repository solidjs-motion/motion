import { createSignal, Show } from "solid-js"
import { Presence, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// PresenceWithDrag — verifies the gesture-state line 232 override: when
// drag is enabled, the diff effect normally locks the `x`/`y` keys to drag's
// claim. EXIT must override that, otherwise an element being dragged at
// unmount time would silently leave without playing its exit translation.
//
// The card is draggable. Drag it sideways, then click "remove". Watch how
// exit's `x: 320` reaches the DOM even though you've been steering `x` from
// the drag gesture — exit is the highest-priority driver in the chain.
// ---------------------------------------------------------------------------

export default function PresenceWithDrag() {
  const [mounted, setMounted] = createSignal(true)

  return (
    <div>
      <p style={{ color: "#444", "margin-bottom": "1rem" }}>
        Drag the card around, then click "remove". Exit's translation wins over drag's claim — the
        card glides off to the right regardless of where you left it.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", "margin-bottom": "1.5rem" }}>
        <button type="button" class="demo-button" onClick={() => setMounted((m) => !m)}>
          {mounted() ? "remove" : "add back"}
        </button>
      </div>
      <div
        style={{
          position: "relative",
          "min-height": "200px",
          background: "#f5f5f5",
          "border-radius": "12px",
          padding: "1.5rem",
          overflow: "hidden",
        }}
      >
        <Presence>
          <Show when={mounted()}>{(_v) => <DraggableCard />}</Show>
        </Presence>
      </div>
    </div>
  )
}

function DraggableCard() {
  const motion = useMotion({
    initial: { opacity: 0, x: -32 },
    animate: { opacity: 1, x: 0 },
    drag: true,
    dragConstraints: { left: -120, right: 120, top: -40, bottom: 40 },
    dragElastic: 0.25,
    exit: { opacity: 0, x: 320 },
    transition: { type: "spring", stiffness: 320, damping: 30 },
  })
  return (
    <div
      {...motion({
        style: {
          width: "fit-content",
          padding: "1rem 1.25rem",
          "border-radius": "10px",
          background: "linear-gradient(135deg, #4776e6, #8e54e9)",
          color: "white",
          "font-weight": 600,
          cursor: "grab",
          "user-select": "none",
          "box-shadow": "0 8px 22px rgba(0,0,0,0.15)",
        },
      })}
    >
      drag me, then remove me
    </div>
  )
}
