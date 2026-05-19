import { createSignal, For, Show } from "solid-js"
import { Presence, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// PresenceOrchestratedList — full variant orchestration through <Presence>.
//
// A parent motion shell declares the canonical labels (`"open"` /
// `"closed"`) and wraps its children in `shell.Provider`. The children
// are PASSIVE consumers — no own `animate` prop — so they inherit the
// parent's active label via VariantContext. Each child resolves the
// shared label against its OWN variants map, computing a staggered
// per-index delay via `custom`.
//
// Presence makes the exit work end-to-end:
//   1. Toggle `mounted` to false — Show flips, Presence intercepts.
//   2. Presence walks the subtree rooted at the shell. EVERY nested motion
//      child's runExit fires concurrently (the descendant-walk fix).
//   3. Each child's runExit re-reads opts at exit time, sees the inherited
//      "closed" label via the parent context, resolves its own variant,
//      and animates out with its staggered delay.
//   4. The combined Promise.all keeps the shell mounted until every
//      descendant animation has settled.
//
// This is the motion-react canonical "AnimatePresence + orchestrated
// variants" pattern, ported faithfully.
// ---------------------------------------------------------------------------

const ITEMS = ["fade", "slide", "scale", "rotate", "spring", "tween"]

export default function PresenceOrchestratedList() {
  const [mounted, setMounted] = createSignal(true)

  return (
    <div>
      <p style={{ color: "#444", "margin-bottom": "1rem" }}>
        Toggle to mount and unmount the list. The parent shell dictates the active label
        (<code>"open"</code> on enter, <code>"closed"</code> on exit) via{" "}
        <code>m.Provider</code>; passive children inherit that label and resolve their own
        variant map for it. Per-index staggers come from <code>custom</code>.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", "margin-bottom": "1.5rem" }}>
        <button type="button" class="demo-button" onClick={() => setMounted((m) => !m)}>
          {mounted() ? "unmount" : "mount"} list
        </button>
      </div>
      <div
        style={{
          "min-height": "260px",
          background: "#f5f5f5",
          "border-radius": "12px",
          padding: "1.5rem",
        }}
      >
        <Presence>
          <Show when={mounted()}>
            <Shell />
          </Show>
        </Presence>
      </div>
    </div>
  )
}

function Shell() {
  // The parent motion element. It owns the canonical label vocabulary and
  // an exit that flips to "closed" on unmount. Its own variants are empty
  // — it doesn't itself animate beyond what its children do — but the
  // active label cascades through `motion.Provider` to descendants.
  const motion = useMotion({
    initial: "closed",
    animate: "open",
    exit: "closed",
    variants: {
      open: {},
      closed: {},
    },
  })
  return (
    <ul
      {...motion({
        style: {
          "list-style": "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gap: "0.5rem",
        },
      })}
    >
      <motion.Provider>
        <For each={ITEMS}>{(label, i) => <Item index={i()} label={label} />}</For>
      </motion.Provider>
    </ul>
  )
}

function Item(props: { index: number; label: string }) {
  // Passive consumer — no own animate label. The parent's "open"/"closed"
  // label cascades in via VariantContext. The exit label is captured here
  // explicitly so Presence registers a runExit for this element (the
  // subtree-walk picks it up when Shell unmounts).
  const motion = useMotion(() => ({
    custom: props.index,
    variants: {
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
            // Reverse stagger on close — last item leaves first.
            delay: (ITEMS.length - 1 - i) * 0.05,
            duration: 0.22,
          },
        }
      },
    },
  }))
  return (
    <li
      {...motion({
        style: {
          padding: "0.6rem 0.85rem",
          background: "white",
          "border-radius": "8px",
          border: "1px solid #e0e0e0",
          "font-family": "ui-monospace, monospace",
          "font-size": "0.9rem",
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
        },
      })}
    >
      <span>{props.label}</span>
      <span style={{ color: "#aaa", "font-size": "0.75rem" }}>#{props.index}</span>
    </li>
  )
}
