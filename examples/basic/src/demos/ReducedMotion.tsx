import { createReducedMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// ReducedMotion — surfaces `prefers-reduced-motion` as a Solid Accessor.
// Toggle the OS-level pref to see this update without reload (the underlying
// matchMedia change event drives the signal).
// ---------------------------------------------------------------------------

export default function ReducedMotion() {
  const reduced = createReducedMotion()
  return (
    <div>
      <p style={{ color: "var(--color-fg)" }}>
        Current system preference:&nbsp;
        <strong style={{ color: reduced() ? "#e52e71" : "#0a7" }}>
          {reduced() ? "reduce" : "no-preference"}
        </strong>
      </p>
      <p style={{ color: "var(--color-muted)", "font-size": "0.875rem" }}>
        Wrap a subtree with <code>&lt;MotionConfig reducedMotion="user" /&gt;</code> to make every
        nested useMotion respect this pref automatically.
      </p>
    </div>
  )
}
