import { createSignal, Show } from "solid-js"
import { Presence, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// PresenceFade — the canonical single-element exit. <Presence> keeps the
// motion child in the DOM after `<Show when>` flips false, runs its `exit`
// target, then releases it for unmount. Without <Presence> the element is
// removed instantly and `exit` never plays.
// ---------------------------------------------------------------------------

export default function PresenceFade() {
  const [open, setOpen] = createSignal(true)

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Toggle the card. <code>&lt;Presence&gt;</code> keeps it mounted while the <code>exit</code>{" "}
        animation plays.
      </p>
      <button
        type="button"
        class="demo-button"
        onClick={() => setOpen((o) => !o)}
        style={{ "margin-bottom": "1.5rem" }}
      >
        {open() ? "hide" : "show"} card
      </button>
      <div style={{ "min-height": "120px" }}>
        <Presence>
          <Show when={open()}>{(_v) => <Card />}</Show>
        </Presence>
      </div>
    </div>
  )
}

function Card() {
  // initial → animate runs on mount. `exit` runs when <Presence>'s
  // descendant resolution loses this element (here: when `<Show>` flips).
  const motion = useMotion({
    initial: { opacity: 0, y: 12, scale: 0.96 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -12, scale: 0.96 },
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
  })
  return (
    <div
      {...motion({
        style: {
          padding: "1.25rem 1.5rem",
          "border-radius": "12px",
          background: "linear-gradient(135deg, #6a5acd, #20b2aa)",
          color: "white",
          "font-weight": 600,
          "font-size": "1.1rem",
          "box-shadow": "0 8px 24px rgba(0,0,0,0.08)",
        },
      })}
    >
      I animate in. I also animate out.
    </div>
  )
}
