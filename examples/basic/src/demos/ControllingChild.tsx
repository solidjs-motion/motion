import { createSignal } from "solid-js"
import { useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// ControllingChild — the "controlling variants" rule (motion-dom parity).
//
// A motion node opts OUT of inheriting its parent's variant cascade when any
// of its own `initial`/`animate`/`hover`/`press`/`focus`/`inView` props
// carries a variant label (a string or string[]). That node becomes
// "controlling" — its variants are driven by ITS OWN label, not the parent's.
//
// Side-by-side demo:
//   - Toggle the parent between "active" / "idle".
//   - Passive child (no animate prop) follows the parent: animates with each
//     toggle.
//   - Controlling child has `animate: "rest"` — a fixed label of its own —
//     so the parent's toggle has no effect on it. It stays at "rest".
//
// This isn't a side effect: it's intentional. Children that need their own
// motion state (e.g., a hover-only effect on a card whose parent is doing
// something unrelated) declare any variant label themselves to break the
// inheritance link.
// ---------------------------------------------------------------------------

export default function ControllingChild() {
  const [active, setActive] = createSignal(false)

  const motion = useMotion(() => ({
    initial: "idle",
    animate: active() ? "active" : "idle",
    variants: {
      idle: { "background-color": "var(--color-surface)" },
      active: { "background-color": "#e3f2fd" },
    },
    transition: { duration: 0.3 },
  }))

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Toggle the parent. The <strong>passive child</strong> (no animate prop) inherits the
        parent's label and follows along. The <strong>controlling child</strong> has its own{" "}
        <code>animate: "rest"</code> and opts out — the cascade stops there.
      </p>
      <button
        type="button"
        class="demo-button"
        onClick={() => setActive((a) => !a)}
        style={{ "margin-bottom": "1.5rem" }}
      >
        toggle parent ({active() ? "active" : "idle"})
      </button>
      <div
        {...motion({
          style: {
            padding: "1.5rem",
            "border-radius": "12px",
            display: "grid",
            "grid-template-columns": "1fr 1fr",
            gap: "1rem",
          },
        })}
      >
        <motion.Provider>
          <PassiveChild />
          <ControllingChildBox />
        </motion.Provider>
      </div>
    </div>
  )
}

function PassiveChild() {
  // No animate label — variant context provides the active label ("idle" or
  // "active") and this child resolves it against its OWN variants.
  const m = useMotion(() => ({
    variants: {
      idle: { scale: 1, rotate: 0 },
      active: { scale: 1.05, rotate: 5 },
    },
    transition: { type: "spring", stiffness: 300, damping: 22 },
  }))
  return (
    <div
      {...m({
        style: {
          padding: "1rem",
          "border-radius": "10px",
          background: "linear-gradient(135deg, #00e5ff, #2979ff)",
          color: "white",
          "text-align": "center",
          "font-weight": 600,
        },
      })}
    >
      passive
      <div style={{ "font-size": "0.75rem", "font-weight": 400, "margin-top": "0.25rem" }}>
        follows parent
      </div>
    </div>
  )
}

function ControllingChildBox() {
  // `animate: "rest"` makes this node CONTROLLING — it provides its own
  // active label. The parent's "idle" / "active" cascade does not reach
  // here; the child sits at "rest" regardless of parent state.
  const m = useMotion(() => ({
    animate: "rest",
    variants: {
      rest: { scale: 1, rotate: 0 },
      // Defining additional variants here is fine; they just never get
      // triggered because nothing drives the active label away from "rest".
      active: { scale: 1.2, rotate: -10 },
    },
    transition: { type: "spring", stiffness: 300, damping: 22 },
  }))
  return (
    <div
      {...m({
        style: {
          padding: "1rem",
          "border-radius": "10px",
          background: "linear-gradient(135deg, #ff8a00, #e52e71)",
          color: "white",
          "text-align": "center",
          "font-weight": 600,
        },
      })}
    >
      controlling
      <div style={{ "font-size": "0.75rem", "font-weight": 400, "margin-top": "0.25rem" }}>
        ignores parent
      </div>
    </div>
  )
}
