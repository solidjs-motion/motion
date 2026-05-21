import { createSignal, onCleanup, onMount } from "solid-js"
import { createMotionValue, createSpring, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// CreateSpring — spring-smoothed mirror of a numeric input. Useful when you
// have a raw value that jumps (pointer position, scroll progress, a signal)
// and want the consumer to track it with physics-based easing instead of
// snapping.
//
// Demo: two dots track the pointer.
//   - The blue dot reads the raw pointer position (no smoothing, jumps).
//   - The orange dot reads a `createSpring(rawMV)` — same source, but the
//     spring smooths every change. Drag your cursor across the pad; the
//     spring lags behind with elastic motion.
//
// Both are wired through `useMotion` targets — createSpring returns a
// MotionValueAccessor, so it composes with animate targets the same way
// createMotionValue does.
// ---------------------------------------------------------------------------

export default function CreateSpringDemo() {
  const x = createMotionValue(0)
  const y = createMotionValue(0)
  // createSpring takes the source MV and returns a new MotionValueAccessor
  // that mirrors it through a spring. Stiffness/damping control how
  // responsive vs. how bouncy the follow feels.
  const smoothX = createSpring(x, { stiffness: 140, damping: 18 })
  const smoothY = createSpring(y, { stiffness: 140, damping: 18 })

  const rawDot = useMotion({ animate: { x, y } })
  const springDot = useMotion({ animate: { x: smoothX, y: smoothY } })

  const [padEl, setPadEl] = createSignal<HTMLDivElement>()

  onMount(() => {
    const pad = padEl()
    if (!pad) return
    const onMove = (e: PointerEvent) => {
      const rect = pad.getBoundingClientRect()
      // Center-relative so x=0, y=0 places the dot at the pad's center.
      x.set(e.clientX - rect.left - rect.width / 2)
      y.set(e.clientY - rect.top - rect.height / 2)
    }
    pad.addEventListener("pointermove", onMove)
    onCleanup(() => pad.removeEventListener("pointermove", onMove))
  })

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Move your cursor over the pad. The blue dot tracks the raw position; the orange dot is the
        same value piped through <code>createSpring</code> — physics-smoothed.
      </p>
      <div
        ref={setPadEl}
        style={{
          position: "relative",
          height: "320px",
          "border-radius": "16px",
          background: "var(--color-surface)",
          border: "1px dashed var(--color-border)",
          overflow: "hidden",
        }}
      >
        <div
          {...rawDot({
            style: {
              position: "absolute",
              top: "50%",
              left: "50%",
              "margin-top": "-8px",
              "margin-left": "-8px",
              width: "16px",
              height: "16px",
              "border-radius": "50%",
              background: "#2979ff",
              "pointer-events": "none",
            },
          })}
        />
        <div
          {...springDot({
            style: {
              position: "absolute",
              top: "50%",
              left: "50%",
              "margin-top": "-16px",
              "margin-left": "-16px",
              width: "32px",
              height: "32px",
              "border-radius": "50%",
              background: "linear-gradient(135deg, #ff8a00, #e52e71)",
              "box-shadow": "0 6px 18px rgba(229, 46, 113, 0.4)",
              "pointer-events": "none",
            },
          })}
        />
      </div>
      <div
        style={{
          display: "flex",
          gap: "1rem",
          "margin-top": "1rem",
          "font-family": "ui-monospace, monospace",
          "font-size": "0.85rem",
          color: "var(--color-muted)",
        }}
      >
        <div>
          raw: {x().toFixed(0)}, {y().toFixed(0)}
        </div>
        <div>
          spring: {smoothX().toFixed(0)}, {smoothY().toFixed(0)}
        </div>
      </div>
    </div>
  )
}
