import { createSignal } from "solid-js"
import { motion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// LayoutToggle — motion's classic switch demo.
//
// The parent track is a flex container whose `justify-content` flips
// between `flex-start` and `flex-end`. The handle inside is a
// `<motion.div layout>` — when `justify-content` changes, the parent
// reflows and pushes the handle to the other end. The `layout` prop
// catches the position delta via `parent-MutationObserver` (parent's
// `style` attribute changed → siblings re-measure) and FLIPs the
// handle from its old slot to its new slot.
//
// No keyframes, no `animate` target, no manual translate — the parent's
// layout change IS the animation source.
// ---------------------------------------------------------------------------

export default function LayoutToggle() {
  const [on, setOn] = createSignal(false)
  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Click the switch. The track's <code>justify-content</code> flips between{" "}
        <code>flex-start</code> and <code>flex-end</code>; <code>&lt;motion.div layout&gt;</code> on
        the handle catches the position delta and FLIPs the translate. No keyframes, no animation
        target — the parent's layout change is the only source.
      </p>
      <button
        type="button"
        role="switch"
        aria-checked={on()}
        data-testid="switch-track"
        onClick={() => setOn((p) => !p)}
        style={{
          // Reset every user-agent button default that could affect layout
          // between renders. Buttons inherit `display: inline-block`,
          // `vertical-align: baseline`, native font/border, and (in some
          // browsers) `transform` rules that subtly shift the bcr after the
          // first paint — so on the first toggle the baseline rect captured
          // at mount differs from the post-click rect by a few pixels.
          appearance: "none",
          border: "none",
          font: "inherit",
          padding: "4px",
          // Flex container — the layout knob.
          display: "flex",
          "align-items": "center",
          "justify-content": on() ? "flex-end" : "flex-start",
          // Visual.
          "box-sizing": "border-box",
          width: "72px",
          height: "40px",
          background: on() ? "var(--color-motion)" : "var(--color-primary)",
          "border-radius": "20px",
          cursor: "pointer",
          transition: "background 200ms ease",
        }}
      >
        <motion.div
          layout
          data-testid="switch-handle"
          style={{
            width: "32px",
            height: "32px",
            "border-radius": "16px",
            background: "#ffffff",
            "box-shadow": "0 2px 4px rgba(0, 0, 0, 0.2)",
          }}
        />
      </button>
    </div>
  )
}
