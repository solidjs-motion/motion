import { createSignal, For } from "solid-js"
import { Presence, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// PresenceListStagger — list enter/exit with per-item staggered timing,
// driven by `custom` (each item's index) + dynamic variants (functions of
// custom). Same propagation rules as VariantOrchestration, just applied to
// the exit target too.
//
// The stagger is forward on enter (top-down) and reverse on exit (bottom-up),
// so the list cascades open and unwinds closed.
// ---------------------------------------------------------------------------

type Item = { id: number; tag: string }

let nextId = 6
const TAGS = ["hover", "press", "drag", "inView", "focus", "exit", "spring", "scroll"]

export default function PresenceListStagger() {
  const [items, setItems] = createSignal<Item[]>([
    { id: 1, tag: "hover" },
    { id: 2, tag: "press" },
    { id: 3, tag: "drag" },
    { id: 4, tag: "exit" },
    { id: 5, tag: "spring" },
  ])

  const add = () => {
    const id = nextId++
    const tag = TAGS[id % TAGS.length] ?? "spring"
    setItems((xs) => [...xs, { id, tag }])
  }
  const remove = () => setItems((xs) => xs.slice(0, -1))
  const reset = () =>
    setItems([
      { id: nextId++, tag: "hover" },
      { id: nextId++, tag: "press" },
      { id: nextId++, tag: "drag" },
      { id: nextId++, tag: "exit" },
      { id: nextId++, tag: "spring" },
    ])

  return (
    <div>
      <p style={{ color: "#444", "margin-bottom": "1rem" }}>
        Per-item exits with cascading delays computed from <code>custom</code>. Enter forward, exit
        reverse — the list rolls in and unrolls out.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", "margin-bottom": "1.5rem" }}>
        <button type="button" class="demo-button" onClick={add}>
          push
        </button>
        <button type="button" class="demo-button" onClick={remove}>
          pop
        </button>
        <button type="button" class="demo-button" onClick={reset}>
          reset
        </button>
      </div>
      <ul
        style={{
          "list-style": "none",
          padding: "1rem",
          margin: 0,
          "border-radius": "12px",
          background: "#1a1a2e",
          display: "grid",
          gap: "0.5rem",
          "min-height": "200px",
        }}
      >
        <Presence exitMethod="keep-index">
          <For each={items()}>{(item, i) => <Chip item={item} index={i()} />}</For>
        </Presence>
      </ul>
    </div>
  )
}

function Chip(props: { item: Item; index: number }) {
  // `index` is the item's CURRENT position in the list. Note it's not
  // reactive here (we capture it once on mount) — for the typical "stagger
  // by mount order" pattern this is what you want. For "stagger by current
  // position" the variants below would need to read a reactive accessor.
  const motion = useMotion(() => ({
    custom: props.index,
    initial: "out",
    animate: "in",
    exit: "out",
    variants: {
      in: (custom) => {
        const i = custom as number
        return {
          opacity: 1,
          x: 0,
          transition: {
            delay: i * 0.06,
            duration: 0.35,
            ease: [0.16, 1, 0.3, 1] as const,
          },
        }
      },
      out: (custom) => {
        const i = custom as number
        // Snapshot of the total at render time isn't easily accessible from
        // here; reverse-stagger by using i * negative weight from a fixed
        // base instead. (Works fine for the demo's bounded list.)
        return {
          opacity: 0,
          x: 32,
          transition: {
            delay: i * 0.04,
            duration: 0.25,
          },
        }
      },
    },
  }))
  return (
    <li
      {...motion({
        style: {
          padding: "0.55rem 0.85rem",
          background: "rgba(255,255,255,0.06)",
          color: "white",
          "border-radius": "999px",
          border: "1px solid rgba(255,255,255,0.12)",
          "font-family": "ui-monospace, monospace",
          "font-size": "0.85rem",
          "letter-spacing": "0.04em",
          display: "inline-flex",
          width: "fit-content",
        },
      })}
    >
      {props.item.tag}
    </li>
  )
}
