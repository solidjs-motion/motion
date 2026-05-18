import { createSignal, For } from "solid-js"
import { createInView } from "solidjs-motion"

// ---------------------------------------------------------------------------
// InViewLiveRatio — demonstrates the multi-threshold form of `amount`.
//
// IntersectionObserver fires its callback once per threshold crossing. With
// a single threshold (the default), it fires at enter and leave — and
// `view.entry().intersectionRatio` between crossings is stale. By passing
// an ARRAY of thresholds we ask the observer to fire at each step, giving
// near-continuous ratio updates.
//
// 21 thresholds (every 5%) is plenty for visually-smooth scroll-linked
// effects without flooding the JS thread. The cost is one extra notify
// per ~5% scroll past the element — cheap compared to a scroll-event
// listener that fires every frame.
// ---------------------------------------------------------------------------

// 21 thresholds: 0.00, 0.05, 0.10, ..., 1.00. Update granularity ≈ 5%.
const FINE_THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20)

export default function InViewLiveRatio() {
  return (
    <div>
      <p style={{ color: "#444", "margin-bottom": "1rem" }}>
        Scroll. Each card uses a 21-threshold array (5% steps), so the observer fires continuously
        as you scroll past — visible opacity and scale track
        <code> view.entry().intersectionRatio</code> live.
      </p>
      <div style={{ display: "grid", gap: "1rem" }}>
        <For each={Array.from({ length: 6 })}>{(_, i) => <Watcher index={i()} />}</For>
      </div>
      <div style={{ height: "40vh" }} />
    </div>
  )
}

function Watcher(props: { index: number }) {
  const [el, setEl] = createSignal<HTMLDivElement>()
  // Multi-threshold form — passes through to IntersectionObserver as
  // `threshold: [0, 0.05, ..., 1]`. The entry updates ~21 times per scroll
  // pass, enough for smooth visual tracking.
  const view = createInView(el, { amount: FINE_THRESHOLDS })
  const ratio = () => view.entry()?.intersectionRatio ?? 0
  return (
    <div
      ref={setEl}
      style={{
        padding: "1.25rem",
        "border-radius": "12px",
        background: "white",
        border: "1px solid #eee",
        // Visual reads ratio() directly — with the fine array threshold,
        // this updates smoothly as the card scrolls through the viewport.
        opacity: 0.3 + 0.7 * ratio(),
        transform: `scale(${0.95 + 0.05 * ratio()})`,
        "transform-origin": "center center",
      }}
    >
      <div style={{ "font-weight": 600, "margin-bottom": "0.5rem" }}>Card {props.index + 1}</div>
      <div
        style={{
          "font-family": "ui-monospace, monospace",
          "font-size": "0.85rem",
          color: "#666",
        }}
      >
        isInView: <strong>{String(view.isInView())}</strong>
        &nbsp;·&nbsp; live ratio: <strong>{ratio().toFixed(2)}</strong>
      </div>
    </div>
  )
}
