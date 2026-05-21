import { createSignal, Show } from "solid-js"
import { Presence, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// PresenceImageStack — Tinder-style draggable card stack. Drag a card past
// ±100px and release to dismiss; release within the threshold and it
// springs back. Buttons fire the same dismissal imperatively.
//
// Two library mechanics this demo leans on:
//   1. Exit's reactive `props.direction` — useMotion's function form re-
//      reads opts at exit time, so the swiped/clicked direction is the one
//      the card flies off in (rather than whichever direction was live
//      when the card mounted).
//   2. Presence sets `pointer-events: none` on exiting elements so the new
//      top card is immediately draggable even while the old one is
//      animating out on top of it.
// ---------------------------------------------------------------------------

const CARDS = [
  { id: "a", title: "Yosemite", body: "Granite walls, ribbon falls." },
  { id: "b", title: "Banff", body: "Glacier-blue lakes, pine air." },
  { id: "c", title: "Patagonia", body: "End-of-the-world horizons." },
  { id: "d", title: "Iceland", body: "Black sand and steam vents." },
] as const

type Direction = "left" | "right" | null

export default function PresenceImageStack() {
  const [idx, setIdx] = createSignal(0)
  const [direction, setDirection] = createSignal<Direction>(null)
  // CARDS is non-empty and we modulo idx by its length, so these indexes
  // always resolve. The fallback to CARDS[0] is just to satisfy strict
  // noUncheckedIndexedAccess — runtime never hits it.
  const FIRST = CARDS[0]
  const current = () => CARDS[idx() % CARDS.length] ?? FIRST
  const next = () => CARDS[(idx() + 1) % CARDS.length] ?? FIRST

  const dismiss = (d: "left" | "right") => {
    setDirection(d)
    setIdx((i) => i + 1)
    // Reset direction after the exit settles so the next dismiss picks
    // the fresh user direction. 600ms covers the spring's settle time.
    window.setTimeout(() => setDirection(null), 600)
  }

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Drag the top card past the edge, or use the buttons. The exit's <code>x</code> tracks the
        swipe direction; the next card promotes into place.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", "margin-bottom": "1.5rem" }}>
        <button type="button" class="demo-button" onClick={() => dismiss("left")}>
          ← swipe left
        </button>
        <button type="button" class="demo-button" onClick={() => dismiss("right")}>
          swipe right →
        </button>
      </div>
      <div
        style={{
          position: "relative",
          height: "260px",
          background: "var(--color-surface)",
          "border-radius": "16px",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          overflow: "hidden",
        }}
      >
        {/* Background placeholder for the "next" card peeking through. */}
        <NextPlaceholder card={next()} />
        <Presence>
          <Show when={current()} keyed>
            {(c) => <SwipeCard card={c} onDismiss={dismiss} direction={direction()} />}
          </Show>
        </Presence>
      </div>
    </div>
  )
}

function NextPlaceholder(props: { card: (typeof CARDS)[number] }) {
  return (
    <div
      style={{
        position: "absolute",
        width: "220px",
        height: "180px",
        "border-radius": "14px",
        background: "linear-gradient(135deg, #2c3e50, #4ca1af)",
        opacity: 0.4,
        transform: "scale(0.95)",
        display: "flex",
        "flex-direction": "column",
        "justify-content": "center",
        "align-items": "center",
        color: "white",
        "font-weight": 600,
      }}
    >
      <div style={{ "font-size": "1.1rem", "margin-bottom": "0.25rem" }}>{props.card.title}</div>
      <div style={{ opacity: 0.85, "font-size": "0.85rem" }}>up next</div>
    </div>
  )
}

const PALETTES = {
  a: "linear-gradient(135deg, #ff8a00, #e52e71)",
  b: "linear-gradient(135deg, #56ccf2, #2f80ed)",
  c: "linear-gradient(135deg, #11998e, #38ef7d)",
  d: "linear-gradient(135deg, #834d9b, #d04ed6)",
} as const

function SwipeCard(props: {
  card: (typeof CARDS)[number]
  onDismiss: (d: "left" | "right") => void
  direction: Direction
}) {
  // Function-form useMotion — opts.exit re-evaluates each time the
  // surrounding `direction` signal changes. createMotion's runExit reads
  // opts.exit fresh at exit time (not at mount), so whichever way the
  // user just swiped is the way the card flies off, even though the
  // parent's `direction` signal was set the moment BEFORE the swap
  // triggered this card's unmount.
  const motion = useMotion(() => ({
    initial: { opacity: 0, scale: 0.94 },
    animate: { opacity: 1, scale: 1, x: 0, rotate: 0 },
    drag: "x",
    dragConstraints: { left: 0, right: 0 },
    dragElastic: 0.6,
    exit:
      props.direction === "left"
        ? { x: -400, opacity: 0, rotate: -18 }
        : props.direction === "right"
          ? { x: 400, opacity: 0, rotate: 18 }
          : { x: 0, opacity: 0, scale: 0.92 },
    transition: { type: "spring", stiffness: 260, damping: 22 },
    onDragEnd: (_event, info) => {
      // 100px threshold either direction triggers a dismiss.
      if (info.offset.x < -100) props.onDismiss("left")
      else if (info.offset.x > 100) props.onDismiss("right")
    },
  }))
  return (
    <div
      {...motion({
        style: {
          position: "absolute",
          width: "240px",
          height: "200px",
          "border-radius": "16px",
          background: PALETTES[props.card.id],
          color: "white",
          "box-shadow": "0 14px 32px rgba(0,0,0,0.25)",
          cursor: "grab",
          "user-select": "none",
          padding: "1.25rem",
          display: "flex",
          "flex-direction": "column",
          "justify-content": "flex-end",
        },
      })}
    >
      <div style={{ "font-size": "1.4rem", "font-weight": 700 }}>{props.card.title}</div>
      <div style={{ opacity: 0.9, "font-size": "0.9rem", "margin-top": "0.25rem" }}>
        {props.card.body}
      </div>
    </div>
  )
}
