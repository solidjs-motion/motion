import { createSignal, For } from "solid-js"
import { MotionConfig, type Transition, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// MotionConfig — share transition defaults (and other config) across a
// subtree. Each useMotion's transition still wins per-call, but values left
// unset fall through to the surrounding MotionConfig.
//
// Useful for design-system layers ("all card hovers in this section use a
// shared spring") or for honoring the user's reduced-motion preference
// without each component checking it.
//
// Demo: three identical boxes. The OUTER MotionConfig sets the default
// spring. A SWITCH below swaps to a slower duration transition. Without
// changing anything inside the boxes, all three pick up the new default.
// ---------------------------------------------------------------------------

type Preset = "spring" | "slow" | "snap"

const PRESETS: Record<Preset, Transition> = {
  spring: { type: "spring", stiffness: 350, damping: 22 },
  // cubic-bezier as a 4-tuple satisfies motion's Easing type.
  slow: { duration: 1.2, ease: [0.16, 1, 0.3, 1] },
  snap: { duration: 0.12, ease: [0.4, 0, 1, 1] },
}

export default function MotionConfigDemo() {
  const [preset, setPreset] = createSignal<Preset>("spring")

  return (
    <div>
      <p style={{ color: "#444", "margin-bottom": "1rem" }}>
        Three boxes share their transition default via{" "}
        <code>&lt;MotionConfig transition={"{...}"}&gt;</code>. Change the preset and every box
        picks up the new physics — no per-box wiring needed.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", "margin-bottom": "1.5rem" }}>
        <For each={Object.keys(PRESETS) as Preset[]}>
          {(p) => (
            <button
              type="button"
              onClick={() => setPreset(p)}
              style={{
                padding: "0.4rem 0.8rem",
                border: "1px solid #ddd",
                "border-radius": "6px",
                background: preset() === p ? "#111" : "white",
                color: preset() === p ? "white" : "#333",
                cursor: "pointer",
                font: "inherit",
                "font-size": "0.85rem",
                "text-transform": "capitalize",
              }}
            >
              {p}
            </button>
          )}
        </For>
      </div>
      <MotionConfig transition={PRESETS[preset()]}>
        <div style={{ display: "grid", "grid-template-columns": "repeat(3, 1fr)", gap: "1rem" }}>
          <SharedBox color="linear-gradient(135deg, #00e5ff, #2979ff)" />
          <SharedBox color="linear-gradient(135deg, #ff8a00, #e52e71)" />
          <SharedBox color="linear-gradient(135deg, #00e676, #2979ff)" />
        </div>
      </MotionConfig>
    </div>
  )
}

function SharedBox(props: { color: string }) {
  const [on, setOn] = createSignal(false)
  // NO transition prop here — it inherits the MotionConfig default. The
  // animate target alone drives the motion; physics come from above.
  const m = useMotion(() => ({
    animate: on() ? { y: -40, scale: 1.1 } : { y: 0, scale: 1 },
  }))
  return (
    <button
      type="button"
      onClick={() => setOn((v) => !v)}
      style={{
        border: 0,
        padding: 0,
        background: "transparent",
        cursor: "pointer",
        font: "inherit",
      }}
    >
      <div
        {...m({
          style: {
            height: "120px",
            "border-radius": "12px",
            background: props.color,
            color: "white",
            display: "grid",
            "place-items": "center",
            "font-weight": 600,
          },
        })}
      >
        tap me
      </div>
    </button>
  )
}
