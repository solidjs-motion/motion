import { createSignal } from "solid-js"
import { useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// Toggle — signal-driven variant swap. Reactive-form useMotion (the
// function-shaped options) tracks `open()` and re-targets the animation
// whenever the signal flips. Spring transition shows physics-based easing.
// ---------------------------------------------------------------------------

export default function Toggle() {
  const [open, setOpen] = createSignal(false)
  const motion = useMotion(() => ({
    initial: "closed",
    variants: {
      open: { x: 200, scale: 1.2 },
      closed: { x: 0, scale: 1 },
    },
    animate: open() ? "open" : "closed",
    transition: { type: "spring", stiffness: 200, damping: 20 },
  }))
  return (
    <div>
      <button
        type="button"
        class="demo-button"
        onClick={() => setOpen((o) => !o)}
        style={{ "margin-bottom": "1.5rem" }}
      >
        toggle ({open() ? "open" : "closed"})
      </button>
      <div
        {...motion({
          style: {
            width: "80px",
            height: "80px",
            "border-radius": "12px",
            background: "linear-gradient(135deg, #ff8a00, #e52e71)",
          },
        })}
      />
    </div>
  )
}
