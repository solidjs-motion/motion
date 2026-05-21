import { createSignal } from "solid-js"
import { createPan, createTransform, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// Pan — standalone createPan returns an object with MotionValueAccessors at
// every numeric leaf (point.x, point.y, delta.x, ...). Because each leaf
// is a MotionValue, you can pipe it directly through createTransform,
// useMotion targets, animate(), etc. — same composability as createScroll.
//
// Demo: pan the gradient pad. The hue rotation of the indicator dot is
// driven by `pan.offset.x` → createTransform → useMotion. The pad's own
// color shifts on `pan.isPanning()`.
// ---------------------------------------------------------------------------

export default function Pan() {
  const [padEl, setPadEl] = createSignal<HTMLDivElement>()
  const pan = createPan(padEl)

  // pan.offset.x is a MotionValueAccessor<number>. createTransform maps it
  // to a CSS `hue-rotate(...)` string. The result is itself a
  // MotionValueAccessor<string>, ready to drop into a style binding via
  // useMotion's target or read directly with `hueFilter()`.
  const hueFilter = createTransform(
    pan.offset.x,
    [-200, 0, 200],
    ["hue-rotate(-180deg)", "hue-rotate(0deg)", "hue-rotate(180deg)"],
  )
  const dotMotion = useMotion(() => ({
    animate: { filter: hueFilter() },
    transition: { duration: 0 },
  }))

  // Pad styling responds to `pan.isPanning()` — a plain Solid Accessor
  // (booleans aren't animate-able, so we did not wrap it in a MotionValue).
  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Drag inside the pad. The dot's hue is driven by <code>pan.offset.x</code> piped through{" "}
        <code>createTransform</code>.
      </p>
      <div
        ref={setPadEl}
        style={{
          height: "240px",
          "border-radius": "16px",
          background: pan.isPanning()
            ? "linear-gradient(135deg, #ff8a00, #e52e71)"
            : "linear-gradient(135deg, #00e5ff, #2979ff)",
          transition: "background 0.2s ease",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "touch-action": "none",
          cursor: pan.isPanning() ? "grabbing" : "grab",
        }}
      >
        <div
          {...dotMotion({
            style: {
              width: "60px",
              height: "60px",
              "border-radius": "50%",
              background: "var(--color-elevated)",
              "box-shadow": "0 6px 18px rgba(0,0,0,0.2)",
            },
          })}
        />
      </div>
      <dl
        style={{
          "margin-top": "1.5rem",
          display: "grid",
          "grid-template-columns": "auto 1fr",
          gap: "0.5rem 1.5rem",
          "font-family": "ui-monospace, monospace",
          "font-size": "0.85rem",
          color: "var(--color-muted)",
        }}
      >
        <dt>isPanning</dt>
        <dd style={{ margin: 0 }}>{String(pan.isPanning())}</dd>
        <dt>offset.x</dt>
        <dd style={{ margin: 0 }}>{pan.offset.x().toFixed(1)}</dd>
        <dt>offset.y</dt>
        <dd style={{ margin: 0 }}>{pan.offset.y().toFixed(1)}</dd>
        <dt>velocity.x</dt>
        <dd style={{ margin: 0 }}>{pan.velocity.x().toFixed(1)} px/s</dd>
      </dl>
    </div>
  )
}
