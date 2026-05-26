import { createSignal, For } from "solid-js"
import { bench, describe, vi } from "vitest"
import { render } from "./_render"

// Raw pointer-event dispatcher (mirrors bench 06's shim — jsdom's
// PointerEvent ignores most `PointerEventInit` fields out of the box,
// so we set the few props pan/drag actually reads.
type PointerInit = { pointerId: number; isPrimary?: boolean; clientX: number; clientY: number }
function dispatchPointer(target: EventTarget, type: string, init: PointerInit): void {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & PointerInit
  Object.assign(ev, {
    pointerId: init.pointerId,
    isPrimary: init.isPrimary ?? true,
    clientX: init.clientX,
    clientY: init.clientY,
    pointerType: "mouse",
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
  })
  target.dispatchEvent(ev)
}

vi.mock("motion", async () => {
  const actual = await vi.importActual<typeof import("motion")>("motion")
  return {
    ...actual,
    animate: vi.fn(() => ({
      stop: () => {},
      pause: () => {},
      play: () => {},
      cancel: () => {},
      complete: () => {},
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable — mocks motion's animate() controls so we can `await` them in bench without paying the WAA cost.
      then: (resolve: () => void) => {
        resolve()
        return Promise.resolve()
      },
    })),
  }
})

const installMatchMedia = (): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const stubRect = (
  el: Element,
  rect: { x: number; y: number; width: number; height: number },
): void => {
  el.getBoundingClientRect = (): DOMRect => new DOMRect(rect.x, rect.y, rect.width, rect.height)
}

const { Reorder } = await import("../src/reorder")

// What this measures
// ------------------
// Per-iteration JS cost of one center-cross during a drag-reorder session
// in an N-item vertical list. Each iteration dispatches a single
// pointermove that crosses exactly one sibling's center, triggering:
//
//   pointermove fires
//     → motion-dom pan handler → composed onDrag
//     → createReorder.handleDrag center-cross loop
//     → internalSetValues(swapped) → Solid <For> reconcile + DOM reorder
//     → parent MutationObserver fires synchronously (microtask)
//     → N sibling controllers run runMeasurement synchronously inside
//       the MO callback (sub-paint correctness — see
//       createLayoutController.ts:636 comment)
//     → each measureLocal: E.bcr + P.bcr + DOMMatrix parse + ancestor
//       translate walk
//     → 2 controllers (the swapped pair) see a non-epsilon delta and
//       dispatch FLIP via mocked motion.animate (4 axis MVs each)
//     → 98 controllers see First === Last after epsilon and bail
//     → cumulative-layout-delta MV compensation on the dragged item
//
// Mechanism: iterations alternate between forward and backward
// crossings of the SAME sibling pair, so the dragged item oscillates
// between two adjacent slots forever. Same code path in either
// direction; no per-iteration reset cost folded in. Steady-state
// per-crossing JS cost is what governs whether a real drag feels smooth.
//
// Excluded: WAA cost (mocked), real pointer-event compositor cost, real
// browser layout/paint. Numbers are useful as a relative regression
// signal, not as absolute frame-budget promises. See BASELINES.md.

const ITEM_HEIGHT = 30
const ITEM_WIDTH = 200

function setupReorder(N: number): {
  unmount: () => void
  container: HTMLElement
  pointerId: number
} {
  installMatchMedia()
  // documentElement is the implicit projection parent for the layout
  // controllers (no <motion.X layout> ancestor in this tree, so each
  // item's projectionContext resolves to documentElement). The bcr's
  // origin determines the projection-parent-local coords.
  stubRect(document.documentElement, { x: 0, y: 0, width: 1000, height: 1000 })

  const initialItems = Array.from({ length: N }, (_, i) => i)
  const [items, setItems] = createSignal<number[]>(initialItems)

  const { container, unmount } = render(() => (
    <Reorder.Group values={items} onReorder={setItems}>
      <For each={items()}>
        {(item) => (
          <Reorder.Item value={item} as="div">
            <span>{item}</span>
          </Reorder.Item>
        )}
      </For>
    </Reorder.Group>
  ))

  // Stub each item's bcr to a clean vertical stack. The createReorder
  // snapshot path uses offsetTop/Left/Width/Height when available;
  // jsdom returns 0 for those, so it falls back to bcr (per the
  // jsdom branch in snapshotAll). The layout controller's measureLocal
  // also uses bcr. Both paths read these stubs.
  //
  // Reorder.Group renders <ul> by default; items are its direct children.
  const ul = container.firstElementChild as HTMLElement
  const itemEls = Array.from(ul.children) as HTMLElement[]
  if (itemEls.length !== N) {
    throw new Error(`expected ${N} items, got ${itemEls.length}`)
  }
  for (let i = 0; i < itemEls.length; i++) {
    stubRect(itemEls[i] as HTMLElement, {
      x: 0,
      y: i * ITEM_HEIGHT,
      width: ITEM_WIDTH,
      height: ITEM_HEIGHT,
    })
  }
  // The ul itself is observed via parent MO; bcr stub keeps measurements
  // sensible if anything reads it.
  stubRect(ul, { x: 0, y: 0, width: ITEM_WIDTH, height: N * ITEM_HEIGHT })

  // Open a drag session on item 0. Bench 06 pattern:
  //   1. pointerdown at start position
  //   2. small threshold-crosser to open the pan/drag session
  // Item 0's center is at y=15 (top=0, height=30). We pointerdown at
  // (100, 100) — the offset to item 0's slot center is (..., -85), which
  // means draggedCenter = 15 + offset.y. With offset.y=10 (pointermove
  // to y=110), draggedCenter = 25, still below item 1's center (45) —
  // doesn't cross. Good: threshold opens drag without firing a swap.
  const pointerId = 1
  const firstItem = itemEls[0] as HTMLElement
  dispatchPointer(firstItem, "pointerdown", { pointerId, clientX: 100, clientY: 100 })
  dispatchPointer(window, "pointermove", { pointerId, clientX: 100, clientY: 110 })

  return { unmount, container, pointerId }
}

describe("reorder crossing — per-crossing JS cost in active drag", () => {
  let state: ReturnType<typeof setupReorder> | null = null
  let toggleY = false

  bench(
    "single crossing in 100-item list",
    () => {
      // Oscillate the pointer around item 1's center. Each call crosses
      // exactly one sibling — forward then backward then forward — and
      // the dragged item swaps slots accordingly. Same code path in
      // either direction.
      const y = toggleY ? 85 : 145
      toggleY = !toggleY
      const s = state
      if (s === null) return
      // pointerId is captured at setup, doesn't need to change per iter.
      dispatchPointer(window, "pointermove", { pointerId: s.pointerId, clientX: 100, clientY: y })
    },
    {
      setup: () => {
        state = setupReorder(100)
        toggleY = false
      },
      teardown: () => {
        if (state) {
          dispatchPointer(window, "pointerup", {
            pointerId: state.pointerId,
            clientX: 100,
            clientY: 115,
          })
          state.unmount()
          state = null
        }
      },
    },
  )
})

describe("reorder crossing — slope check at N=1000", () => {
  let state: ReturnType<typeof setupReorder> | null = null
  let toggleY = false

  bench(
    "single crossing in 1000-item list",
    () => {
      const y = toggleY ? 85 : 145
      toggleY = !toggleY
      const s = state
      if (s === null) return
      dispatchPointer(window, "pointermove", { pointerId: s.pointerId, clientX: 100, clientY: y })
    },
    {
      setup: () => {
        state = setupReorder(1000)
        toggleY = false
      },
      teardown: () => {
        if (state) {
          dispatchPointer(window, "pointerup", {
            pointerId: state.pointerId,
            clientX: 100,
            clientY: 115,
          })
          state.unmount()
          state = null
        }
      },
    },
  )
})
