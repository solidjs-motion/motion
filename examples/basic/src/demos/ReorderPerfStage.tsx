import { createMemo, createSignal, For } from "solid-js"
import { Reorder } from "solidjs-motion"

// ---------------------------------------------------------------------------
// ReorderPerfStage — a profiling stage for Reorder + layout animations at
// realistic list sizes. NOT instrumented: the demo deliberately does not
// run its own timing. Open Chrome DevTools → Performance, hit record, click
// "Run auto-drag," stop. The frame timeline is the authoritative read of
// what the architecture costs in the real browser.
//
// Companion to the in-jsdom bench (bench/09-reorder-crossing.bench.tsx).
// The bench measures JS coordination cost with motion.animate mocked out;
// this demo measures everything the bench can't — WAA setup, GPU layer
// promotion, paint, compositor work, GC.
//
// The toggle between "minimal" and "card" row variants separates the
// library's overhead (minimal) from a realistic feature's total cost (card).
// CSS for the card variant is intentionally boring — border + padding +
// background, no filters, no backdrop-blur, no animated gradients — so the
// number reflects the cost of a plausible row, not a CSS edge case.
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
      subtitle: `entry #${i} · row ${i + 1} of ${n}`,
      tone: TONES[i % TONES.length] as string,
    })
  }
  return items
}

// Auto-drag: dispatches a forward + return sweep on the first item, one
// pointermove per RAF tick. RAF locks dispatch to the display's paint
// cadence (~60 Hz) so each synthetic event lands just before the frame
// it would affect. The earlier `setTimeout(50)` approach fired at 20 Hz,
// leaving 2 paint frames empty between events; the dragged item would
// lurch then sit still then lurch again, reading as stutter.
//
// Reproducibility, not visual fidelity. Real mouse drags fire at
// 120–240 Hz with 2–8 px deltas; we're capped at 60 Hz (RAF). Synthetic
// input cannot fully impersonate real input; the auto-drag's job is to
// produce a repeatable cascade for DevTools recordings, not to look
// indistinguishable from a manual drag. For visual smoothness
// evaluation, drag manually.
//
// STEP_PX of 5 trades total displacement (900 px each way instead of
// 1800) for smaller per-step jumps, which the eye reads as less
// obviously stepped. Still produces ~15 crossings at card-row heights —
// plenty for a perf observation window.
const STEPS = 180
const STEP_PX = 5

function rafTick(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function runAutoDrag(groupEl: HTMLElement): Promise<void> {
  const firstItem = groupEl.firstElementChild as HTMLElement | null
  if (!firstItem) return
  const rect = firstItem.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const startY = rect.top + rect.height / 2

  const dispatchOn = (target: EventTarget, type: string, clientY: number): void => {
    target.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        isPrimary: true,
        clientX: x,
        clientY,
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
      }),
    )
  }

  // pointerdown on the item. After this, motion-dom captures the pointer
  // and listens on window for move/up.
  dispatchOn(firstItem, "pointerdown", startY)
  // Threshold cross to open the drag session.
  await rafTick()
  dispatchOn(window, "pointermove", startY + 10)

  // Forward sweep — STEPS frames × STEP_PX = total displacement.
  for (let k = 1; k <= STEPS; k++) {
    await rafTick()
    dispatchOn(window, "pointermove", startY + 10 + k * STEP_PX)
  }
  // Return sweep.
  for (let k = STEPS; k >= 0; k--) {
    await rafTick()
    dispatchOn(window, "pointermove", startY + 10 + k * STEP_PX)
  }

  dispatchOn(window, "pointerup", startY + 10)
}

export default function ReorderPerfStage() {
  const [n, setN] = createSignal<number>(100)
  const [variant, setVariant] = createSignal<"minimal" | "card">("minimal")
  const [running, setRunning] = createSignal(false)
  // drag-scroll knobs — the group is scrollable (max-height + overflow), so
  // dragging an item toward the top/bottom edge auto-scrolls. Toggle off to
  // feel the difference; tune speed/threshold to sanity-check the options.
  const [dragScroll, setDragScroll] = createSignal(true)
  const [dragScrollSpeed, setDragScrollSpeed] = createSignal(720)
  const [dragScrollThreshold, setDragScrollThreshold] = createSignal(80)

  // Regenerate items whenever N changes; createMemo dedupes when the same N
  // is selected. The fresh array reference is what onReorder mutates.
  const initial = createMemo<Item[]>(() => makeItems(n()))
  const [items, setItems] = createSignal<Item[]>(initial())
  // Reset items whenever N changes (initial() ref changes too).
  let lastN = n()
  const itemsForN = (): Item[] => {
    if (n() !== lastN) {
      lastN = n()
      setItems(initial())
    }
    return items()
  }

  let groupRef: HTMLElement | undefined

  const onAutoDrag = async (): Promise<void> => {
    if (running() || !groupRef) return
    setRunning(true)
    try {
      await runAutoDrag(groupRef)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Profiling stage for Reorder + layout at realistic list sizes. Open Chrome DevTools →
        Performance, hit record, click <strong>Run auto-drag</strong>, stop. The frame timeline is
        the authoritative measurement — this demo deliberately does not run its own timing. Pair
        with the JS-coordination numbers in <code>bench/BASELINES.md</code> §09 to separate library
        overhead from real-browser paint/composite/GC.
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
            disabled={running()}
            data-testid="reorder-perf/n-selector"
          >
            <For each={N_CHOICES}>{(choice) => <option value={choice}>{choice}</option>}</For>
          </select>
        </label>
        <label style={{ color: "var(--color-fg)", display: "flex", gap: "0.4rem" }}>
          row:
          <select
            value={variant()}
            onChange={(e) => setVariant(e.currentTarget.value as "minimal" | "card")}
            disabled={running()}
            data-testid="reorder-perf/variant-selector"
          >
            <option value="minimal">minimal</option>
            <option value="card">card</option>
          </select>
        </label>
        <button
          type="button"
          onClick={onAutoDrag}
          disabled={running()}
          data-testid="reorder-perf/auto-drag"
          style={{
            padding: "0.4rem 0.9rem",
            "border-radius": "6px",
            border: "1px solid var(--color-border)",
            background: running() ? "var(--color-surface)" : "var(--color-elevated)",
            color: "var(--color-fg)",
            cursor: running() ? "wait" : "pointer",
          }}
        >
          {running() ? "Running…" : "Run auto-drag"}
        </button>

        <span
          style={{ width: "1px", "align-self": "stretch", background: "var(--color-border)" }}
        />

        <label style={{ color: "var(--color-fg)", display: "flex", gap: "0.4rem" }}>
          <input
            type="checkbox"
            checked={dragScroll()}
            onChange={(e) => setDragScroll(e.currentTarget.checked)}
            disabled={running()}
            data-testid="reorder-perf/drag-scroll"
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
            disabled={running() || !dragScroll()}
            data-testid="reorder-perf/drag-scroll-speed"
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
            disabled={running() || !dragScroll()}
            data-testid="reorder-perf/drag-scroll-threshold"
            style={{ width: "5rem" }}
          />
        </label>
      </div>

      <Reorder.Group
        ref={(el: HTMLElement) => {
          groupRef = el
        }}
        values={itemsForN}
        onReorder={setItems}
        dragScroll={dragScroll()}
        dragScrollSpeed={dragScrollSpeed()}
        dragScrollThreshold={dragScrollThreshold()}
        data-testid="reorder-perf/group"
        style={{
          "list-style": "none",
          padding: "0.5rem",
          margin: 0,
          "border-radius": "10px",
          background: "var(--color-surface)",
          display: "flex",
          "flex-direction": "column",
          gap: "0.35rem",
          "max-height": "70vh",
          overflow: "auto",
        }}
      >
        <For each={itemsForN()}>{(item) => <Row item={item} variant={variant()} />}</For>
      </Reorder.Group>
    </div>
  )
}

function Row(props: { item: Item; variant: "minimal" | "card" }): import("solid-js").JSX.Element {
  return (
    <Reorder.Item
      value={props.item}
      data-testid={`reorder-perf/item/${props.item.id}`}
      style={
        props.variant === "minimal"
          ? {
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
            <span
              style={{
                "margin-left": "auto",
                color: "var(--color-muted)",
                "font-size": "0.7rem",
              }}
            >
              #{props.item.id}
            </span>
          </div>
          <div style={{ color: "var(--color-muted)", "font-size": "0.75rem" }}>
            {props.item.subtitle}
          </div>
          <div style={{ display: "flex", gap: "0.35rem" }}>
            <Tag>todo</Tag>
            <Tag>perf</Tag>
            <Tag>{props.item.tone.replace("#", "")}</Tag>
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
