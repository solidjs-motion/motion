import { useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// GestureComposition — hover, press, and focus stacked on one element. The
// gesture state machine (Phase 2 commit 1) decides per-property which
// currently-active state wins via the "winners memo" — later gestures
// override earlier ones for any key they target.
//
// Try:
//   - mouse-over to see hover scale
//   - press to see hover + press stack (press's scale wins over hover's)
//   - tab in via the keyboard to see focus (focus-visible only fires on
//     keyboard nav, not click — Q12 gating)
// ---------------------------------------------------------------------------

export default function GestureComposition() {
  const motion = useMotion({
    initial: { scale: 1, "background-color": "#2979ff" },
    hover: { scale: 1.05, "background-color": "#1565c0" },
    press: { scale: 0.95, "background-color": "#0d47a1" },
    focus: { scale: 1.1, "background-color": "#7c4dff" },
    transition: { type: "spring", stiffness: 400, damping: 25 },
  })
  return (
    <div>
      <p style={{ color: "#444", "margin-bottom": "1rem" }}>
        Hover / press / Tab into the button below. Each gesture has its own variant; the state
        machine picks a winner per CSS property when multiple are active.
      </p>
      <button
        type="button"
        {...motion({
          style: {
            border: 0,
            color: "white",
            "font-weight": 600,
            padding: "1.5rem 2rem",
            "border-radius": "12px",
            cursor: "pointer",
            font: "inherit",
          },
        })}
      >
        hover · press · focus
      </button>
    </div>
  )
}
