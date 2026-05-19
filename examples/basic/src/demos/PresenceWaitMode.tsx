import { createSignal, Show } from "solid-js"
import { Presence, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// PresenceWaitMode — side-by-side comparison of `mode="sync"` (default) and
// `mode="wait"`.
//
// One button advances BOTH panels at the same time so the difference is
// inescapable:
//   - SYNC: old slides leftward WHILE new slides in from the right. For ~600ms
//     both panels are visible in the same strip — crossing paths in the middle.
//   - WAIT: old fully slides out to the left, THEN the new slides in from the
//     right. Only one panel is ever in the strip at a time, and the swap
//     takes ~1.2s instead of ~600ms.
// ---------------------------------------------------------------------------

const PAGES = [
  { id: "intro", color: "#5b8def", title: "Page 1" },
  { id: "features", color: "#11998e", title: "Page 2" },
  { id: "ssr", color: "#ee0979", title: "Page 3" },
  { id: "tiny", color: "#f7971e", title: "Page 4" },
] as const

export default function PresenceWaitMode() {
  const [pageIdx, setPageIdx] = createSignal(0)
  const page = () => PAGES[pageIdx() % PAGES.length] ?? PAGES[0]

  return (
    <div>
      <p style={{ color: "#444", "margin-bottom": "1rem" }}>
        One button drives both strips. <strong>sync</strong> on top: panels cross paths in the
        middle of the strip (both visible at once). <strong>wait</strong> on bottom: panel fully
        leaves before the next arrives (only one visible at a time, twice as long total).
      </p>
      <div style={{ display: "flex", gap: "0.5rem", "margin-bottom": "1.5rem" }}>
        <button
          type="button"
          class="demo-button"
          onClick={() => setPageIdx((i) => (i + 1) % PAGES.length)}
        >
          next →
        </button>
        <span
          style={{
            "align-self": "center",
            "font-family": "ui-monospace, monospace",
            "font-size": "0.8rem",
            color: "#888",
          }}
        >
          page {pageIdx() + 1} / {PAGES.length}
        </span>
      </div>
      <div style={{ display: "grid", gap: "1rem" }}>
        <Strip label="sync — parallel exit + enter" mode="sync" current={page()} />
        <Strip label="wait — sequential exit then enter" mode="wait" current={page()} />
      </div>
    </div>
  )
}

function Strip(props: {
  label: string
  mode: "sync" | "wait"
  current: (typeof PAGES)[number]
}) {
  return (
    <div>
      <div
        style={{
          "font-family": "ui-monospace, monospace",
          "font-size": "0.8rem",
          color: "#666",
          "margin-bottom": "0.4rem",
        }}
      >
        {props.label}
      </div>
      <div
        style={{
          position: "relative",
          height: "140px",
          "border-radius": "12px",
          overflow: "hidden",
          background: "#f5f5f5",
        }}
      >
        <Presence mode={props.mode}>
          <Show when={props.current} keyed>
            {(p) => <Panel page={p} />}
          </Show>
        </Presence>
      </div>
    </div>
  )
}

function Panel(props: { page: (typeof PAGES)[number] }) {
  // Large slide (full width) + 700ms ease-out so the user sees the
  // intermediate "two panels in flight" frame for sync, and the empty
  // moment between exit and enter for wait.
  const motion = useMotion({
    initial: { opacity: 0, x: 360 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -360 },
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  })
  return (
    <div
      {...motion({
        style: {
          position: "absolute",
          inset: 0,
          padding: "1.5rem 2rem",
          background: props.page.color,
          color: "white",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "font-size": "1.6rem",
          "font-weight": 700,
          "letter-spacing": "0.02em",
        },
      })}
    >
      {props.page.title}
    </div>
  )
}
