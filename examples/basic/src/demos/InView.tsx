import { createSignal, For } from "solid-js"
import { createInView } from "solidjs-motion"

// ---------------------------------------------------------------------------
// InView — standalone createInView returns two Solid Accessors:
//   - view.isInView() — boolean, true while the threshold is met
//   - view.entry()    — the raw IntersectionObserverEntry, refreshed on
//                       every transition (enter AND leave)
//
// IMPORTANT semantic this demo highlights: with a single `amount` threshold
// (the default `"some"` → threshold 0, or a single number like 0.5), the
// underlying IntersectionObserver only fires on threshold crossings. Between
// crossings the entry does NOT update — `view.entry().intersectionRatio` is
// a SNAPSHOT taken at the most recent crossing, not a continuous reading.
//
// For continuous ratio updates, pass an array of thresholds (see the
// adjacent "InView (live ratio)" demo).
//
// Both fields are plain Accessors (not MotionValues) because booleans and
// entries aren't animate-able — the semantic split is documented in
// createPan's JSDoc.
// ---------------------------------------------------------------------------

export default function InView() {
  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Scroll. Each card flips <code>isInView</code> and snapshots the{" "}
        <code>IntersectionObserverEntry</code> at the moment it enters or leaves the viewport. The
        ratio shown is captured at the crossing — it does NOT update while the card sits partially
        visible. For live ratio tracking, see the
        <em> live ratio</em> demo.
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
  // Default `amount` is "some" → threshold 0 → observer fires at the
  // enter and leave moments, never in between. The entry's snapshot is
  // what we read.
  const view = createInView(el)
  const entrySnapshot = () => view.entry()?.intersectionRatio ?? 0
  return (
    <div
      ref={setEl}
      style={{
        padding: "1.25rem",
        "border-radius": "12px",
        // In-view state: subtle primary tint on the surface + stronger
        // primary tint on the border. Color-mix scales the brand color
        // against the current surface/border value so the same rule
        // looks right in light AND dark mode.
        background: view.isInView()
          ? "color-mix(in srgb, var(--color-primary) 8%, var(--color-elevated))"
          : "var(--color-surface)",
        border: view.isInView()
          ? "1px solid color-mix(in srgb, var(--color-primary) 45%, var(--color-border))"
          : "1px solid var(--color-border)",
        // The visual state IS reactive on isInView (which flips at each
        // crossing). We intentionally do NOT animate based on the ratio
        // here — that would be misleading given the single-threshold
        // observer semantic.
        transition: "background 0.2s, border-color 0.2s",
      }}
    >
      <div style={{ "font-weight": 600, "margin-bottom": "0.5rem" }}>Card {props.index + 1}</div>
      <div
        style={{
          "font-family": "ui-monospace, monospace",
          "font-size": "0.85rem",
          color: "var(--color-muted)",
        }}
      >
        isInView:{" "}
        <strong style={{ color: view.isInView() ? "var(--color-primary)" : "var(--color-muted)" }}>
          {String(view.isInView())}
        </strong>
        &nbsp;·&nbsp; last-crossing ratio: <strong>{entrySnapshot().toFixed(2)}</strong>
      </div>
    </div>
  )
}
