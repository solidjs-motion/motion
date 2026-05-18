import { createSignal } from "solid-js"
import {
  createMotionValue,
  createSpring,
  createTime,
  createTransform,
  createVelocity,
  useMotion,
} from "solidjs-motion"

// ---------------------------------------------------------------------------
// CreateVelocityTime — two derived MotionValue primitives in concert.
//
//   createTime()       → a MotionValueAccessor<number> that advances every
//                        animation frame with elapsed milliseconds. Use it
//                        as a driver for time-based transforms (oscillators,
//                        progress bars, looping animations).
//
//   createVelocity(mv) → a MotionValueAccessor<number> reporting the
//                        instantaneous velocity of another MV. Updates
//                        whenever the source changes.
//
// Demo: an oscillator driven by `createTime` (a sine wave through
// createTransform). A second box reads `createVelocity` of the oscillator's
// position and tilts proportionally — visualizing the derivative of motion.
// Underneath, a separate "click to jump" target shows velocity spiking on
// abrupt changes via a spring.
// ---------------------------------------------------------------------------

export default function CreateVelocityTime() {
  // ---- Oscillator (time → position → velocity) ----
  const t = createTime() // ms since this primitive was called
  // Sine wave driven by t — createTransform interpolates t through a piecewise
  // range. We use a 4000ms period (1 → 0 → 1 → 0 → 1).
  const oscillatorX = createTransform(t, [0, 1000, 2000, 3000, 4000], [0, 120, 0, -120, 0])
  // Velocity of the oscillator's x — high at the zero-crossings of the
  // sine wave, near zero at the peaks. Visualized as a rotation.
  const oscillatorVelocity = createVelocity(oscillatorX)
  // Rotation degrees mirror velocity sign — clockwise when moving right,
  // counter-clockwise when moving left.
  const tilt = createTransform(oscillatorVelocity, [-500, 0, 500], [-20, 0, 20])

  const oscBox = useMotion({ animate: { x: oscillatorX, rotate: tilt } })

  // ---- Click-to-jump (spring → velocity readout) ----
  const target = createMotionValue(0)
  const smooth = createSpring(target, { stiffness: 80, damping: 12 })
  const smoothVelocity = createVelocity(smooth)
  const jumpBox = useMotion({ animate: { x: smooth } })
  const [step, setStep] = createSignal(0)

  return (
    <div>
      <p style={{ color: "#444", "margin-bottom": "1.5rem" }}>
        <strong>Top:</strong> <code>createTime()</code> drives a sine-wave x position;
        <code>createVelocity()</code> on that x rotates the box — tilting in the direction of
        motion.
        <br />
        <strong>Bottom:</strong> click <em>Jump</em> to displace the target. The spring glides to
        it; the live velocity readout shows the derivative.
      </p>

      <Section title="time + velocity → oscillator with motion-direction tilt">
        <div
          style={{
            height: "120px",
            "border-radius": "12px",
            background: "#f5f5f5",
            display: "grid",
            "place-items": "center",
            position: "relative",
          }}
        >
          <div
            {...oscBox({
              style: {
                width: "60px",
                height: "60px",
                "border-radius": "12px",
                background: "linear-gradient(135deg, #00e5ff, #2979ff)",
              },
            })}
          />
        </div>
        <ReadoutRow
          values={[
            { label: "t (ms)", value: t().toFixed(0) },
            { label: "x", value: oscillatorX().toFixed(1) },
            { label: "velocity", value: oscillatorVelocity().toFixed(0) },
          ]}
        />
      </Section>

      <Section title="spring + velocity readout">
        <div
          style={{
            height: "120px",
            "border-radius": "12px",
            background: "#f5f5f5",
            display: "grid",
            "place-items": "center",
          }}
        >
          <div
            {...jumpBox({
              style: {
                width: "60px",
                height: "60px",
                "border-radius": "12px",
                background: "linear-gradient(135deg, #ff8a00, #e52e71)",
              },
            })}
          />
        </div>
        <div style={{ display: "flex", gap: "0.5rem", "margin-top": "0.75rem" }}>
          <button
            type="button"
            class="demo-button"
            onClick={() => {
              const next = step() + 1
              setStep(next)
              target.set(((next % 3) - 1) * 100)
            }}
          >
            jump
          </button>
          <button
            type="button"
            class="demo-button"
            style={{ background: "#666" }}
            onClick={() => {
              setStep(0)
              target.set(0)
            }}
          >
            reset
          </button>
        </div>
        <ReadoutRow
          values={[
            { label: "target", value: target().toFixed(0) },
            { label: "smooth", value: smooth().toFixed(1) },
            { label: "velocity", value: smoothVelocity().toFixed(0) },
          ]}
        />
      </Section>
    </div>
  )
}

function Section(props: { title: string; children: import("solid-js").JSX.Element }) {
  return (
    <section style={{ "margin-bottom": "2rem" }}>
      <h3
        style={{
          "font-size": "0.85rem",
          "text-transform": "uppercase",
          "letter-spacing": "0.08em",
          color: "#888",
          margin: "0 0 0.75rem",
          "font-weight": 600,
        }}
      >
        {props.title}
      </h3>
      {props.children}
    </section>
  )
}

function ReadoutRow(props: { values: Array<{ label: string; value: string }> }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "1.5rem",
        "margin-top": "0.75rem",
        "font-family": "ui-monospace, monospace",
        "font-size": "0.85rem",
        color: "#555",
      }}
    >
      {props.values.map((v) => (
        <div>
          <span style={{ color: "#999" }}>{v.label}:</span> {v.value}
        </div>
      ))}
    </div>
  )
}
