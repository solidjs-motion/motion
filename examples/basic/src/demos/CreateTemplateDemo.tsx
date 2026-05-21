import { createMotionValue, createTemplate } from "solidjs-motion"

// ---------------------------------------------------------------------------
// CreateTemplate — tagged template literal that interpolates MotionValues
// (and Solid Accessors) into a string MotionValueAccessor. Recomputes the
// output whenever any input changes.
//
// Useful when you want to write a CSS string with multiple reactive bits
// (a `transform: ...` composed of separate x/y/scale MVs, a `clip-path`
// driven by scroll, a `filter` chain, etc.) and have it stay reactive.
//
// Demo: three sliders drive `x`, `y`, `rotate`. createTemplate composes them
// into a transform string, applied to the gradient box via the `transform`
// CSS property — bypassing useMotion entirely. The text below shows the
// live template output so the composition is visible.
// ---------------------------------------------------------------------------

export default function CreateTemplateDemo() {
  const x = createMotionValue(0)
  const y = createMotionValue(0)
  const rotate = createMotionValue(0)

  // Tagged template syntax. The interpolation slots accept MotionValues,
  // Solid Accessors, numbers, or strings. The returned value is itself a
  // MotionValueAccessor<string> — callable as `transform()` for a tracked
  // read, or pass it directly into `useMotion({ animate: { transform } })`.
  const transform = createTemplate`translate(${x}px, ${y}px) rotate(${rotate}deg)`

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Three MotionValues compose into a single transform string via <code>createTemplate</code>.
        The template re-evaluates whenever any input changes — no manual concat, no stale closures.
      </p>
      <div
        style={{
          display: "grid",
          "grid-template-columns": "120px 1fr 80px",
          gap: "0.75rem 1rem",
          "align-items": "center",
          "margin-bottom": "1.5rem",
          "font-family": "ui-monospace, monospace",
          "font-size": "0.85rem",
          color: "var(--color-muted)",
        }}
      >
        <span>x ({x().toFixed(0)}px)</span>
        <input
          type="range"
          min="-150"
          max="150"
          value={x()}
          onInput={(e) => x.set(Number(e.currentTarget.value))}
        />
        <button
          type="button"
          onClick={() => x.set(0)}
          style={{
            padding: "0.2rem 0.4rem",
            border: "1px solid var(--color-border)",
            "border-radius": "4px",
            background: "var(--color-elevated)",
            cursor: "pointer",
            font: "inherit",
            "font-size": "0.75rem",
          }}
        >
          reset
        </button>
        <span>y ({y().toFixed(0)}px)</span>
        <input
          type="range"
          min="-100"
          max="100"
          value={y()}
          onInput={(e) => y.set(Number(e.currentTarget.value))}
        />
        <button
          type="button"
          onClick={() => y.set(0)}
          style={{
            padding: "0.2rem 0.4rem",
            border: "1px solid var(--color-border)",
            "border-radius": "4px",
            background: "var(--color-elevated)",
            cursor: "pointer",
            font: "inherit",
            "font-size": "0.75rem",
          }}
        >
          reset
        </button>
        <span>rotate ({rotate().toFixed(0)}°)</span>
        <input
          type="range"
          min="-180"
          max="180"
          value={rotate()}
          onInput={(e) => rotate.set(Number(e.currentTarget.value))}
        />
        <button
          type="button"
          onClick={() => rotate.set(0)}
          style={{
            padding: "0.2rem 0.4rem",
            border: "1px solid var(--color-border)",
            "border-radius": "4px",
            background: "var(--color-elevated)",
            cursor: "pointer",
            font: "inherit",
            "font-size": "0.75rem",
          }}
        >
          reset
        </button>
      </div>
      <div
        style={{
          height: "240px",
          "border-radius": "12px",
          background: "var(--color-surface)",
          border: "1px dashed var(--color-border)",
          display: "grid",
          "place-items": "center",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: "100px",
            height: "100px",
            "border-radius": "12px",
            background: "linear-gradient(135deg, #00e5ff, #2979ff)",
            // The template's MotionValueAccessor reads reactively in JSX —
            // calling `transform()` subscribes to changes.
            transform: transform(),
          }}
        />
      </div>
      <code
        style={{
          display: "block",
          padding: "0.75rem",
          "margin-top": "1rem",
          background: "#111",
          color: "#a7f0a7",
          "border-radius": "8px",
          "font-size": "0.8rem",
          "overflow-x": "auto",
        }}
      >
        transform: {transform()}
      </code>
    </div>
  )
}
