import { createSignal, Show } from "solid-js"
import {
  createSpring,
  createTemplate,
  createTransform,
  motion,
  Presence,
  type Transition,
} from "solidjs-motion"

// ---------------------------------------------------------------------------
// LayoutIdHandoff — shared-element transition between two motion elements
// that share a `layoutId`. Toggling between thumbnail and hero states
// swaps the JSX subtree (`<Show>` with fallback). The donor's
// `onCleanup` deposits its rect in the LayoutGroup coordinator; the
// consumer's `createMotion` retrieves the entry and FLIPs from the
// donor's position to its own natural position.
//
// `<Presence>` keeps the donor alive in the DOM long enough for any
// exit animation to settle (here a simple opacity fade) — the donor's
// exit and the consumer's FLIP run in parallel without
// cross-cancellation (locked Q5/§6.5 semantics).
// ---------------------------------------------------------------------------

const DEFAULT_TRANSITION = {
  stiffness: 220,
  damping: 28,
} satisfies Transition

export default function LayoutIdHandoff() {
  const [expanded, setExpanded] = createSignal(0)
  const [isAnimating, setIsAnimating] = createSignal(false)

  const t = createSpring(expanded, DEFAULT_TRANSITION)

  const firstStop = createTransform(t, [0, 1], ["#2c5364", "#ee0979"])
  const lastStop = createTransform(t, [0, 1], ["#0f2027", "#ff6a00"])

  const backgroundGradient = createTemplate`linear-gradient(135deg, ${firstStop}, ${lastStop})`

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Click. The thumbnail and the hero share <code>layoutId="card"</code>; the consumer's FLIP
        animates between the donor's position and its own. Both wrapped in{" "}
        <code>&lt;Presence&gt;</code> so the exit runs in parallel with the FLIP.
      </p>
      <button
        type="button"
        class="demo-button"
        onClick={() => setExpanded((p) => (p === 0 ? 1 : 0))}
        style={{ "margin-bottom": "1.5rem" }}
        disabled={isAnimating()}
      >
        {expanded() ? "shrink" : "expand"}
      </button>
      <div style={{ position: "relative", "min-height": "240px" }}>
        <Presence>
          <Show
            when={expanded()}
            fallback={
              <motion.div
                layoutId="card"
                data-testid="card/thumb"
                transition={{ type: "spring", ...DEFAULT_TRANSITION }}
                onLayoutAnimationStart={() => setIsAnimating(true)}
                onLayoutAnimationComplete={() => setIsAnimating(false)}
                style={{
                  width: "100px",
                  height: "100px",
                  "border-radius": "12px",
                  color: "white",
                  "font-weight": 600,
                  display: "grid",
                  "place-items": "center",
                  cursor: "pointer",
                  background: backgroundGradient,
                }}
              >
                thumb
              </motion.div>
            }
          >
            <motion.div
              layoutId="card"
              data-testid="card/hero"
              transition={{ type: "spring", ...DEFAULT_TRANSITION }}
              onLayoutAnimationStart={() => setIsAnimating(true)}
              onLayoutAnimationComplete={() => setIsAnimating(false)}
              style={{
                width: "320px",
                height: "220px",
                "border-radius": "12px",
                color: "white",
                "font-weight": 600,
                "font-size": "1.5rem",
                display: "grid",
                "place-items": "center",
                cursor: "pointer",
                background: backgroundGradient,
              }}
            >
              hero
            </motion.div>
          </Show>
        </Presence>
      </div>
    </div>
  )
}
