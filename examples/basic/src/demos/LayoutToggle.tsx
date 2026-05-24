import { createSignal } from "solid-js"
import { motion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// LayoutToggle — the no-config baseline for layout animations.
//
// Toggling the `expanded` signal changes the element's `style.width` /
// `style.height` via Solid's regular style binding. `<motion.div layout>`
// detects the new bounding rect (via ResizeObserver(self) — the trigger
// for own-dimension changes) and FLIPs from the old rect to the new
// one. No motion-specific glue beyond the `layout` prop itself.
// ---------------------------------------------------------------------------

export default function LayoutToggle() {
  const [expanded, setExpanded] = createSignal(false)
  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Click the card. <code>&lt;motion.div layout&gt;</code> picks up the size change via{" "}
        <code>ResizeObserver(self)</code> and runs a FLIP animation between the two states. No
        keyframes, no transition target — the size DELTA between renders IS the animation.
      </p>
      <motion.div
        layout
        onClick={() => setExpanded((p) => !p)}
        transition={{ type: "spring", stiffness: 220, damping: 26 }}
        style={{
          width: expanded() ? "300px" : "150px",
          height: expanded() ? "180px" : "90px",
          "border-radius": "12px",
          background: "linear-gradient(135deg, #ff8a00, #e52e71)",
          color: "white",
          "font-weight": 600,
          display: "grid",
          "place-items": "center",
          cursor: "pointer",
          "user-select": "none",
        }}
      >
        {expanded() ? "click to shrink" : "click to expand"}
      </motion.div>
    </div>
  )
}
