import { createSignal, For } from "solid-js"
import { motion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// MotionProxyTag — the canonical `<motion.div>` / `<motion.li>` pattern.
//
// This is the same orchestrated-stagger pattern as `VariantOrchestration`
// (Phase 2) — parent declares variant labels, passive children inherit
// the active label via VariantContext, dynamic variants compute per-index
// staggered delays — but rewritten with the Phase 4 motion proxy.
//
// The Phase 4 savings:
//   1. No `useMotion` boilerplate at each call site.
//   2. No manual `<m.Provider>` wrap — every `motion.X` tag-component
//      wraps its rendered output in `m.Provider` UNCONDITIONALLY (B1
//      from ADR 0004), so the cascade reaches descendants for free.
//   3. Motion options sit alongside element attributes on the same tag.
//      `<motion.li animate="open" variants={...} class="my-item">` reads
//      like an enhanced JSX element rather than a separate hook call.
// ---------------------------------------------------------------------------

const ITEMS = ["hover", "press", "drag", "exit", "spring", "scroll"]

export default function MotionProxyTag() {
  const [open, setOpen] = createSignal(true)

  return (
    <div>
      <p style={{ color: "#444", "margin-bottom": "1rem" }}>
        Toggle the parent <code>&lt;motion.ul&gt;</code>. Each <code>&lt;motion.li&gt;</code> is a
        PASSIVE child — it only declares <code>variants</code>, no own <code>animate</code> label —
        and inherits the parent's <code>"open"</code> / <code>"closed"</code> via the auto-Provider
        that every <code>motion.X</code> tag adds for free.
      </p>
      <button
        type="button"
        class="demo-button"
        onClick={() => setOpen((o) => !o)}
        style={{ "margin-bottom": "1.5rem" }}
      >
        {open() ? "close" : "open"} list
      </button>
      <motion.ul
        animate={open() ? "open" : "closed"}
        variants={{
          open: { opacity: 1 },
          closed: { opacity: 0.4 },
        }}
        transition={{ duration: 0.3 }}
        style={{
          "list-style": "none",
          padding: "1rem",
          margin: 0,
          "border-radius": "12px",
          background: "#f5f5f5",
          display: "grid",
          gap: "0.5rem",
        }}
      >
        <For each={ITEMS}>{(label, i) => <Item index={i()} label={label} />}</For>
      </motion.ul>
    </div>
  )
}

function Item(props: { index: number; label: string }) {
  // Passive consumer — no `animate` label of its own. The parent
  // motion.ul's auto-Provider exposes the active label; this item
  // resolves it against its own variants map. `custom` carries the
  // index so the dynamic variants can compute per-position delays.
  return (
    <motion.li
      custom={props.index}
      variants={{
        open: (custom) => {
          const i = custom as number
          return {
            opacity: 1,
            x: 0,
            transition: {
              delay: i * 0.07,
              duration: 0.35,
              ease: [0.16, 1, 0.3, 1] as const,
            },
          }
        },
        closed: (custom) => {
          const i = custom as number
          return {
            opacity: 0,
            x: -16,
            transition: {
              delay: (ITEMS.length - 1 - i) * 0.04,
              duration: 0.2,
            },
          }
        },
      }}
      style={{
        padding: "0.5rem 0.75rem",
        background: "white",
        "border-radius": "8px",
        border: "1px solid #eee",
        "font-family": "ui-monospace, monospace",
        "font-size": "0.9rem",
      }}
    >
      {props.index}. {props.label}
    </motion.li>
  )
}
