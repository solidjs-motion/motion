import { createSignal } from "solid-js"
import { useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// Drag — useMotion's drag prop hands off to createDrag, which composes with
// motion-dom's VisualElement (Q5/C-lean). Drag writes to the element's x/y
// MotionValues; motion's render pipeline turns those into the final
// transform. `whileDrag` is a sibling variant that animates non-translation
// properties (like scale) — the gesture state machine filters x/y from
// whileDrag's target so drag's writes always own translation.
//
// Knobs in this demo:
//   - Axis lock: x / y / both — re-creates the gesture per change
//   - Elastic: 0 (hard clamp) / 0.5 (motion default) / 1 (no resistance)
//   - Momentum: inertia decay after release vs. stop-on-release
// ---------------------------------------------------------------------------

type Axis = "both" | "x" | "y"

export default function Drag() {
  const [axis, setAxis] = createSignal<Axis>("both")
  const [elastic, setElastic] = createSignal(0.5)
  const [momentum, setMomentum] = createSignal(true)
  const [containerEl, setContainerEl] = createSignal<HTMLDivElement>()

  const motion = useMotion(() => {
    const a = axis()
    // Narrow Axis to `true | "x" | "y"` (the shape MotionOptions['drag'] accepts).
    const drag: boolean | "x" | "y" = a === "both" ? true : a
    return {
      drag,
      dragConstraints: containerEl(),
      dragElastic: elastic(),
      dragMomentum: momentum(),
      whileDrag: { scale: 1.05, "box-shadow": "0 12px 24px rgba(0,0,0,0.18)" },
      transition: { type: "spring", stiffness: 350, damping: 25 },
    }
  })

  return (
    <div>
      <div style={{ display: "flex", gap: "1rem", "margin-bottom": "1.5rem", flex: "wrap" }}>
        <Field label="Axis">
          <select
            value={axis()}
            onChange={(e) => setAxis(e.currentTarget.value as Axis)}
            style={controlStyle}
          >
            <option value="both">both</option>
            <option value="x">x only</option>
            <option value="y">y only</option>
          </select>
        </Field>
        <Field label="Elastic">
          <select
            value={String(elastic())}
            onChange={(e) => setElastic(Number(e.currentTarget.value))}
            style={controlStyle}
          >
            <option value="0">0 — hard clamp</option>
            <option value="0.5">0.5 — default</option>
            <option value="1">1 — no resistance</option>
          </select>
        </Field>
        <Field label="Momentum">
          <label style={{ display: "flex", "align-items": "center", gap: "0.4rem" }}>
            <input
              type="checkbox"
              checked={momentum()}
              onChange={(e) => setMomentum(e.currentTarget.checked)}
            />
            inertia on release
          </label>
        </Field>
      </div>
      <div
        ref={setContainerEl}
        style={{
          position: "relative",
          height: "300px",
          background: "var(--color-surface)",
          border: "1px dashed var(--color-border)",
          "border-radius": "12px",
          overflow: "hidden",
        }}
      >
        <div
          {...motion({
            style: {
              position: "absolute",
              top: "50%",
              left: "50%",
              "margin-top": "-40px",
              "margin-left": "-40px",
              width: "80px",
              height: "80px",
              "border-radius": "16px",
              background: "linear-gradient(135deg, #00e5ff, #2979ff)",
              cursor: "grab",
              "touch-action": "none",
            },
          })}
        />
      </div>
    </div>
  )
}

const controlStyle = {
  padding: "0.4rem 0.6rem",
  border: "1px solid var(--color-border)",
  "border-radius": "6px",
  font: "inherit",
  background: "var(--color-elevated)",
}

function Field(props: { label: string; children: import("solid-js").JSX.Element }) {
  // `<div>` rather than `<label>` — the children may themselves be a label
  // (e.g. the checkbox row), and nesting labels is invalid HTML. The visual
  // structure doesn't need a label element; only the immediate
  // input-with-text pairs do (which they handle internally).
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "0.25rem" }}>
      <span style={{ "font-size": "0.75rem", color: "var(--color-muted)" }}>{props.label}</span>
      {props.children}
    </div>
  )
}
