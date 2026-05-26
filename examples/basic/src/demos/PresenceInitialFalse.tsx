import { createSignal, For } from "solid-js"
import { Presence, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// PresenceInitialFalse — `<Presence initial={false}>` suppresses the FIRST
// mount's enter animation but still runs every subsequent enter and exit.
//
// Use case: an SSR'd or page-restored list shouldn't replay its enter cascade
// on hydration; only items added AFTER the first render should animate in.
//
// Important — the motion children must be DIRECT descendants of the
// <Presence initial={false}> boundary. A nested <Presence> (with the default
// initial=true) inside would shadow the outer's flag, since each motion
// child resolves the NEAREST PresenceContext.
// ---------------------------------------------------------------------------

let nextId = 4
type Item = { id: number; text: string }
const seed = (): Item[] => [
  { id: nextId++, text: "alpha" },
  { id: nextId++, text: "beta" },
  { id: nextId++, text: "gamma" },
]

export default function PresenceInitialFalse() {
  const [leftItems, setLeftItems] = createSignal<Item[]>(seed())
  const [rightItems, setRightItems] = createSignal<Item[]>(seed())

  const pushLeft = () =>
    setLeftItems((xs) => [...xs, { id: nextId++, text: `added ${nextId - 1}` }])
  const popLeft = () => setLeftItems((xs) => xs.slice(0, -1))
  const pushRight = () =>
    setRightItems((xs) => [...xs, { id: nextId++, text: `added ${nextId - 1}` }])
  const popRight = () => setRightItems((xs) => xs.slice(0, -1))

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Reload the page and watch the two columns. With{" "}
        <code>&lt;Presence initial={"{false}"}&gt;</code> the initial children appear instantly
        (painted at the animate target); without it they cascade in. Adding items mid-life animates
        the same in both.
      </p>
      <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "1.5rem" }}>
        <Column
          title="initial={false}"
          subtitle="instant first paint, animated thereafter"
          presenceInitial={false}
          items={leftItems()}
          onPush={pushLeft}
          onPop={popLeft}
        />
        <Column
          title="initial (default true)"
          subtitle="full cascade on first paint"
          presenceInitial={undefined}
          items={rightItems()}
          onPush={pushRight}
          onPop={popRight}
        />
      </div>
    </div>
  )
}

function Column(props: {
  title: string
  subtitle: string
  presenceInitial: boolean | undefined
  items: Item[]
  onPush: () => void
  onPop: () => void
}) {
  return (
    <div>
      <div style={{ "font-family": "ui-monospace, monospace", "font-size": "0.85rem" }}>
        {props.title}
      </div>
      <div
        style={{ color: "var(--color-muted)", "font-size": "0.75rem", "margin-bottom": "0.5rem" }}
      >
        {props.subtitle}
      </div>
      <div style={{ display: "flex", gap: "0.35rem", "margin-bottom": "0.75rem" }}>
        <button
          type="button"
          class="demo-button"
          style={{ "font-size": "0.8rem", padding: "0.3rem 0.6rem" }}
          onClick={props.onPush}
        >
          push
        </button>
        <button
          type="button"
          class="demo-button"
          style={{ "font-size": "0.8rem", padding: "0.3rem 0.6rem" }}
          onClick={props.onPop}
        >
          pop
        </button>
      </div>
      {/* SINGLE Presence wrapping the For directly — no nesting. */}
      <ul
        style={{
          "list-style": "none",
          padding: "0.75rem",
          margin: 0,
          "border-radius": "10px",
          background: "var(--color-surface)",
          display: "grid",
          gap: "0.4rem",
          "min-height": "120px",
        }}
      >
        <Presence initial={props.presenceInitial} exitMethod="keep-index">
          <For each={props.items}>{(item) => <Pill text={item.text} />}</For>
        </Presence>
      </ul>
    </div>
  )
}

function Pill(props: { text: string }) {
  const motion = useMotion({
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
    transition: { duration: 0.3 },
  })
  return (
    <li
      {...motion({
        style: {
          padding: "0.4rem 0.7rem",
          background: "var(--color-elevated)",
          "border-radius": "6px",
          border: "1px solid #e0e0e0",
          "font-size": "0.85rem",
        },
      })}
    >
      {props.text}
    </li>
  )
}
