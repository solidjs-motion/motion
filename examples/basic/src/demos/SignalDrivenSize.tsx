import { createMotionValue, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// SignalDrivenSize — createMotionValue returns a callable hybrid: invoke
// `size()` for a Solid-tracked read; call `size.set(...)` / `size.get()` for
// the imperative MotionValue API. Same value drives the JSX text AND the
// useMotion target — when the MV is in a target, motion subscribes to its
// `change` events and re-tweens per-property (see "MV-in-target" in CLAUDE.md).
// ---------------------------------------------------------------------------

export default function SignalDrivenSize() {
  const size = createMotionValue(80)
  const motion = useMotion({
    animate: { width: size, height: size },
    transition: { type: "spring", stiffness: 200, damping: 20 },
  })
  return (
    <div>
      <button
        type="button"
        class="demo-button"
        onClick={() => size.set(size.get() + 20)}
        style={{ "margin-bottom": "1.5rem" }}
      >
        grow ({size()}px)
      </button>
      <div
        {...motion({
          style: {
            "border-radius": "12px",
            background: "linear-gradient(135deg, #00e5ff, #2979ff)",
          },
        })}
      />
    </div>
  )
}
