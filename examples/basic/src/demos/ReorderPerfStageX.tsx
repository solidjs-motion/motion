import { createMemo, createSignal, For } from "solid-js"
import { Reorder } from "solidjs-motion"

// ---------------------------------------------------------------------------
// ReorderPerfStageX — the horizontal twin of ReorderPerfStage. Same profiling
// intent (drag a cell, watch the DevTools frame timeline), but the group is an
// `axis="x"` horizontal scroller, so it exercises the x-axis paths of layout
// FLIP and drag-scroll (scrollLeft / horizontal edges) rather than the y ones.
//
// Drag a cell toward the LEFT or RIGHT edge to trigger horizontal drag-scroll.
// Everything else mirrors the y stage: minimal vs card variants separate
// library overhead from realistic content cost; the demo runs no timing of its
// own — the frame timeline is the source of truth.
// ---------------------------------------------------------------------------

const N_CHOICES = [50, 100, 300, 500, 1000] as const

type Item = { id: number; label: string; subtitle: string; tone: string }

const TONES = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
]

function makeItems(n: number): Item[] {
  const items: Item[] = []
  for (let i = 0; i < n; i++) {
    items.push({
      id: i,
      label: `Item ${i.toString().padStart(4, "0")}`,
      subtitle: `entry #${i} · col ${i + 1} of ${n}`,
      tone: TONES[i % TONES.length] as string,
    })
  }
  return items
}

export default function ReorderPerfStageX() {
  const [n, setN] = createSignal<number>(100)
  const [variant, setVariant] = createSignal<"minimal" | "card">("minimal")
  // drag-scroll knobs — the group is a horizontal scroller (overflow-x: auto),
  // so dragging a cell toward the left/right edge auto-scrolls along x. Toggle
  // off to feel the difference; tune speed/threshold to sanity-check.
  const [dragScroll, setDragScroll] = createSignal(true)
  const [dragScrollSpeed, setDragScrollSpeed] = createSignal(720)
  const [dragScrollThreshold, setDragScrollThreshold] = createSignal(80)

  const initial = createMemo<Item[]>(() => makeItems(n()))
  const [items, setItems] = createSignal<Item[]>(initial())
  let lastN = n()
  const itemsForN = (): Item[] => {
    if (n() !== lastN) {
      lastN = n()
      setItems(initial())
    }
    return items()
  }

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Horizontal profiling stage — an <code>axis="x"</code> Reorder list in a horizontal scroller.
        Open Chrome DevTools → Performance, hit record, <strong>drag a cell</strong> (drag toward
        the left/right edge to exercise horizontal drag-scroll), stop. Mirror of the vertical{" "}
        <code>/reorder-perf</code> stage; pair with <code>bench/BASELINES.md</code> §09.
      </p>

      <div
        style={{
          display: "flex",
          "flex-wrap": "wrap",
          gap: "0.75rem",
          "align-items": "center",
          "margin-bottom": "1rem",
          padding: "0.75rem",
          background: "var(--color-surface)",
          "border-radius": "10px",
        }}
      >
        <label style={{ color: "var(--color-fg)", display: "flex", gap: "0.4rem" }}>
          N:
          <select
            value={n()}
            onChange={(e) => setN(Number(e.currentTarget.value))}
            data-testid="reorder-perf-x/n-selector"
          >
            <For each={N_CHOICES}>{(choice) => <option value={choice}>{choice}</option>}</For>
          </select>
        </label>
        <label style={{ color: "var(--color-fg)", display: "flex", gap: "0.4rem" }}>
          cell:
          <select
            value={variant()}
            onChange={(e) => setVariant(e.currentTarget.value as "minimal" | "card")}
            data-testid="reorder-perf-x/variant-selector"
          >
            <option value="minimal">minimal</option>
            <option value="card">card</option>
          </select>
        </label>
        <label style={{ color: "var(--color-fg)", display: "flex", gap: "0.4rem" }}>
          <input
            type="checkbox"
            checked={dragScroll()}
            onChange={(e) => setDragScroll(e.currentTarget.checked)}
            data-testid="reorder-perf-x/drag-scroll"
          />
          drag-scroll
        </label>
        <label
          style={{
            color: "var(--color-fg)",
            display: "flex",
            gap: "0.4rem",
            opacity: dragScroll() ? "1" : "0.5",
          }}
        >
          speed:
          <input
            type="number"
            min="50"
            max="3000"
            step="60"
            value={dragScrollSpeed()}
            onChange={(e) => setDragScrollSpeed(Number(e.currentTarget.value))}
            disabled={!dragScroll()}
            data-testid="reorder-perf-x/drag-scroll-speed"
            style={{ width: "5rem" }}
          />
        </label>
        <label
          style={{
            color: "var(--color-fg)",
            display: "flex",
            gap: "0.4rem",
            opacity: dragScroll() ? "1" : "0.5",
          }}
        >
          threshold:
          <input
            type="number"
            min="10"
            max="300"
            step="10"
            value={dragScrollThreshold()}
            onChange={(e) => setDragScrollThreshold(Number(e.currentTarget.value))}
            disabled={!dragScroll()}
            data-testid="reorder-perf-x/drag-scroll-threshold"
            style={{ width: "5rem" }}
          />
        </label>
      </div>

      <Reorder.Group
        axis="x"
        values={itemsForN}
        onReorder={setItems}
        dragScroll={dragScroll()}
        dragScrollSpeed={dragScrollSpeed()}
        dragScrollThreshold={dragScrollThreshold()}
        data-testid="reorder-perf-x/group"
        style={{
          "list-style": "none",
          padding: "0.5rem",
          margin: 0,
          "border-radius": "10px",
          background: "var(--color-surface)",
          display: "flex",
          "flex-direction": "row",
          gap: "0.35rem",
          "max-width": "100%",
          "overflow-x": "auto",
        }}
      >
        <For each={itemsForN()}>{(item) => <Cell item={item} variant={variant()} />}</For>
      </Reorder.Group>
    </div>
  )
}

function Cell(props: { item: Item; variant: "minimal" | "card" }): import("solid-js").JSX.Element {
  return (
    <Reorder.Item
      value={props.item}
      data-testid={`reorder-perf-x/item/${props.item.id}`}
      style={
        props.variant === "minimal"
          ? {
              "flex-shrink": "0",
              width: "8rem",
              padding: "0.4rem 0.6rem",
              background: "var(--color-elevated)",
              "border-radius": "6px",
              border: "1px solid var(--color-border)",
              "font-family": "ui-monospace, monospace",
              "font-size": "0.85rem",
              color: "var(--color-fg)",
              cursor: "grab",
              display: "flex",
              "align-items": "center",
              gap: "0.5rem",
              "user-select": "none",
            }
          : {
              "flex-shrink": "0",
              width: "12rem",
              padding: "0.6rem 0.75rem",
              background: "var(--color-elevated)",
              "border-radius": "8px",
              border: "1px solid var(--color-border)",
              "box-shadow": "0 1px 2px rgba(0,0,0,0.08)",
              "font-size": "0.85rem",
              color: "var(--color-fg)",
              cursor: "grab",
              display: "flex",
              "flex-direction": "column",
              gap: "0.3rem",
              "user-select": "none",
            }
      }
      whileDrag={{
        cursor: "grabbing",
        "box-shadow": "0px 6px 18px rgba(0,0,0,0.25)",
        scale: 1.01,
      }}
      transition={{ duration: 0.18 }}
    >
      {props.variant === "minimal" ? (
        <>
          <span
            style={{
              width: "0.55rem",
              height: "0.55rem",
              "border-radius": "999px",
              background: props.item.tone,
              "flex-shrink": "0",
            }}
          />
          <span style={{ "font-family": "ui-monospace, monospace" }}>{props.item.label}</span>
        </>
      ) : (
        <>
          <div style={{ display: "flex", "align-items": "center", gap: "0.5rem" }}>
            <span
              style={{
                width: "0.6rem",
                height: "0.6rem",
                "border-radius": "999px",
                background: props.item.tone,
                "flex-shrink": "0",
              }}
            />
            <strong style={{ "font-size": "0.9rem" }}>{props.item.label}</strong>
          </div>
          <div style={{ color: "var(--color-muted)", "font-size": "0.75rem" }}>
            {props.item.subtitle}
          </div>
          <div style={{ display: "flex", gap: "0.35rem" }}>
            <Tag>todo</Tag>
            <Tag>perf</Tag>
          </div>
        </>
      )}
    </Reorder.Item>
  )
}

function Tag(props: { children: import("solid-js").JSX.Element }): import("solid-js").JSX.Element {
  return (
    <span
      style={{
        padding: "0.1rem 0.4rem",
        "border-radius": "999px",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        color: "var(--color-muted)",
        "font-size": "0.65rem",
        "font-family": "ui-monospace, monospace",
      }}
    >
      {props.children}
    </span>
  )
}
