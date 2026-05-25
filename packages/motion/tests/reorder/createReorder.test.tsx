import { fireEvent, render } from "@solidjs/testing-library"
import { For, createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// createReorder primitive — 4 suites: primitive shape, center-cross
// detection, axis, edge cases. Mocks mirror drag-suppression.test.tsx so
// drag actually produces observable pan/MV updates in JSDOM.
// ---------------------------------------------------------------------------

const { animateSpy, captured, resetCaptured, timeMock } = vi.hoisted(() => {
  type Write = { name: string; value: number }
  const captured: { writes: Write[]; veCreated: number } = { writes: [], veCreated: 0 }

  const animateSpy = vi.fn((..._args: unknown[]) => ({
    stop: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    cancel: vi.fn(),
    complete: vi.fn(),
    // biome-ignore lint/suspicious/noThenProperty: motion's AnimationPlaybackControls is intentionally thenable
    then: (resolve: () => void) => {
      resolve()
      return Promise.resolve()
    },
  }))

  function resetCaptured() {
    captured.writes = []
    captured.veCreated = 0
  }

  const timeMock = { now: vi.fn(() => 0) }

  return { animateSpy, captured, resetCaptured, timeMock }
})

vi.mock("motion", async () => {
  const actual = await vi.importActual<typeof import("motion")>("motion")
  return { ...actual, animate: animateSpy }
})

vi.mock("motion-dom", async () => {
  const actual = await vi.importActual<typeof import("motion-dom")>("motion-dom")

  type MockMV = {
    _name: string
    _value: number
    get: () => number
    set: (v: number) => void
    stop: () => void
    on: () => () => void
    getVelocity: () => number
  }

  function makeMockMV(name: string, initial: number): MockMV {
    const mv: MockMV = {
      _name: name,
      _value: initial,
      get: () => mv._value,
      set: vi.fn((v: number) => {
        mv._value = v
        captured.writes.push({ name, value: v })
      }),
      stop: vi.fn(),
      on: () => () => {},
      getVelocity: () => 0,
    }
    return mv
  }

  class MockHTMLVisualElement {
    private mvs = new Map<string, MockMV>()
    constructor() {
      captured.veCreated++
    }
    mount(_el: HTMLElement): void {}
    getValue(name: string, initial: number): MockMV {
      let mv = this.mvs.get(name)
      if (!mv) {
        mv = makeMockMV(name, initial)
        this.mvs.set(name, mv)
      }
      return mv
    }
  }

  return {
    ...actual,
    HTMLVisualElement: MockHTMLVisualElement,
    visualElementStore: new WeakMap(),
    time: timeMock,
  }
})

const { createReorder } = await import("../../src/primitives/createReorder")

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

const stubRect = (
  el: Element,
  rect: { x: number; y: number; width: number; height: number },
): void => {
  el.getBoundingClientRect = () => new DOMRect(rect.x, rect.y, rect.width, rect.height)
}

let originalDocElementRect: () => DOMRect

beforeEach(() => {
  originalDocElementRect = document.documentElement.getBoundingClientRect.bind(
    document.documentElement,
  )
  stubRect(document.documentElement, { x: 0, y: 0, width: 1000, height: 1000 })
  animateSpy.mockClear()
  resetCaptured()
  timeMock.now.mockReset()
  timeMock.now.mockReturnValue(0)
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
})

afterEach(() => {
  document.documentElement.getBoundingClientRect = originalDocElementRect
  delete (window as Partial<Window>).matchMedia
})

// ---------------------------------------------------------------------------
// Standard list harness — three items A/B/C, each height 100, stacked Y.
// ---------------------------------------------------------------------------

type ListAPI<T> = {
  values: () => T[]
  reorderCalls: () => T[][]
  draggingNow: () => T | null
  el: (value: T) => HTMLElement
  container: HTMLElement
  setExternally: (next: T[]) => void
}

function renderList(
  initial: string[],
  axis: "x" | "y" = "y",
  // Contiguous default (stride === height) gives clean center math:
  // item i has center at `i * 100 + 50` along the axis.
  layout = { stride: 100, width: 100, height: 100 },
  cancelOnExternalReorder = false,
): ListAPI<string> {
  const onReorderCalls: string[][] = []
  let reorderRef!: ReturnType<typeof createReorder<string>>
  let itemsAccessor!: () => string[]
  let setItemsExternally!: (next: string[]) => void

  const { container } = render(() => {
    const [items, setItems] = createSignal(initial)
    itemsAccessor = items
    setItemsExternally = (next) => setItems(next)
    reorderRef = createReorder(
      items,
      (updater) => {
        const next =
          typeof updater === "function"
            ? (updater as (prev: string[]) => string[])(items())
            : updater
        onReorderCalls.push(next)
        setItems(next)
        return next
      },
      () => ({ axis, cancelOnExternalReorder }),
    )

    return (
      <ul ref={reorderRef.group.ref} data-testid="list">
        <For each={items()}>
          {(item) => {
            const m = reorderRef.item(item)
            return (
              <li data-testid={`item-${item}`} {...m()}>
                {item}
              </li>
            )
          }}
        </For>
      </ul>
    )
  })

  // Stub bcrs along the configured axis.
  for (let i = 0; i < initial.length; i++) {
    const value = initial[i] as string
    const el = container.querySelector<HTMLElement>(`[data-testid='item-${value}']`)
    if (el === null) continue
    if (axis === "y") {
      stubRect(el, { x: 0, y: i * layout.stride, width: layout.width, height: layout.height })
    } else {
      stubRect(el, { x: i * layout.stride, y: 0, width: layout.width, height: layout.height })
    }
  }

  return {
    values: itemsAccessor,
    reorderCalls: () => onReorderCalls,
    draggingNow: () => reorderRef.dragging(),
    el: (value) =>
      container.querySelector<HTMLElement>(`[data-testid='item-${value}']`) as HTMLElement,
    container: container as HTMLElement,
    setExternally: (next) => setItemsExternally(next),
  } as ListAPI<string>
}

/** Drive a drag on `el` from `(fromX, fromY)` to `(toX, toY)` and release. */
function drag(
  el: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  fireEvent.pointerDown(el, {
    pointerId: 1,
    clientX: from.x,
    clientY: from.y,
    isPrimary: true,
  })
  // Threshold-cross small first move so pan-start fires.
  fireEvent.pointerMove(window, {
    pointerId: 1,
    clientX: from.x + (to.x === from.x ? 0 : 4),
    clientY: from.y + (to.y === from.y ? 0 : 4),
    isPrimary: true,
  })
  // Now the meaningful move to the target.
  fireEvent.pointerMove(window, {
    pointerId: 1,
    clientX: to.x,
    clientY: to.y,
    isPrimary: true,
  })
  fireEvent.pointerUp(window, {
    pointerId: 1,
    clientX: to.x,
    clientY: to.y,
    isPrimary: true,
  })
}

/** Drag without releasing — leaves the gesture active. */
function dragStart(
  el: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  fireEvent.pointerDown(el, {
    pointerId: 1,
    clientX: from.x,
    clientY: from.y,
    isPrimary: true,
  })
  fireEvent.pointerMove(window, {
    pointerId: 1,
    clientX: from.x + (to.x === from.x ? 0 : 4),
    clientY: from.y + (to.y === from.y ? 0 : 4),
    isPrimary: true,
  })
  fireEvent.pointerMove(window, {
    pointerId: 1,
    clientX: to.x,
    clientY: to.y,
    isPrimary: true,
  })
}

function dragRelease(at: { x: number; y: number }): void {
  fireEvent.pointerUp(window, {
    pointerId: 1,
    clientX: at.x,
    clientY: at.y,
    isPrimary: true,
  })
}

// ---------------------------------------------------------------------------
// Suite 1 — primitive shape
// ---------------------------------------------------------------------------

describe("createReorder: primitive shape", () => {
  it("returns { group, item, dragging } with callable shapes", () => {
    const api = renderList(["a", "b", "c"])
    expect(api.draggingNow()).toBe(null)
    expect(api.values()).toEqual(["a", "b", "c"])
  })

  it("item() returns a useMotion-like callable with Provider", () => {
    // Render directly so we can inspect the returned shape.
    let returned: ReturnType<typeof createReorder<string>>["item"] | undefined
    render(() => {
      const [items, setItems] = createSignal(["a"])
      const reorder = createReorder(items, setItems)
      returned = reorder.item
      return null
    })
    const item = returned as NonNullable<typeof returned>
    const r = item("a")
    expect(typeof r).toBe("function")
    expect(typeof r.Provider).toBe("function")
  })

  it("dragging flips to the dragged value while the pointer is down", () => {
    const api = renderList(["a", "b", "c"])
    expect(api.draggingNow()).toBe(null)
    dragStart(api.el("a"), { x: 0, y: 50 }, { x: 0, y: 60 })
    expect(api.draggingNow()).toBe("a")
    dragRelease({ x: 0, y: 60 })
    expect(api.draggingNow()).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// Suite 2 — center-cross detection
// ---------------------------------------------------------------------------

describe("createReorder: center-cross detection", () => {
  it("swaps a forward (downward) past the next neighbor's center", () => {
    const api = renderList(["a", "b", "c"])
    // a's center is at y=50; b is at y=100..200, center y=150.
    // Drag a from y=50 down past y=150.
    drag(api.el("a"), { x: 50, y: 50 }, { x: 50, y: 160 })
    expect(api.reorderCalls()).toEqual([["b", "a", "c"]])
    expect(api.values()).toEqual(["b", "a", "c"])
  })

  it("swaps backward (upward) past the previous neighbor's center", () => {
    const api = renderList(["a", "b", "c"])
    // c's center is at y=250; b is at y=100..200, center y=150.
    // Drag c from y=250 up past y=150.
    drag(api.el("c"), { x: 50, y: 250 }, { x: 50, y: 140 })
    expect(api.reorderCalls()).toEqual([["a", "c", "b"]])
    expect(api.values()).toEqual(["a", "c", "b"])
  })

  it("does not swap when the drag stays inside its own slot", () => {
    const api = renderList(["a", "b", "c"])
    // Move a only 20px down — its center (50→70) doesn't cross b's center (150).
    drag(api.el("a"), { x: 50, y: 50 }, { x: 50, y: 70 })
    expect(api.reorderCalls()).toEqual([])
    expect(api.values()).toEqual(["a", "b", "c"])
  })

  it("fires multiple swaps in one frame for a long drag", () => {
    const api = renderList(["a", "b", "c", "d"])
    // a's center at y=50; b/c/d centers at 150/250/350.
    // Drag a from y=50 to y=260 — should cross BOTH b and c.
    drag(api.el("a"), { x: 50, y: 50 }, { x: 50, y: 260 })
    // The `while (didSwap)` loop walks step-by-step:
    //   [a,b,c,d] → [b,a,c,d] → [b,c,a,d]
    expect(api.reorderCalls()).toEqual([
      ["b", "a", "c", "d"],
      ["b", "c", "a", "d"],
    ])
    expect(api.values()).toEqual(["b", "c", "a", "d"])
  })

  it("does not fire spurious swaps when the dragged item is released without crossing", () => {
    const api = renderList(["a", "b", "c"])
    drag(api.el("b"), { x: 50, y: 150 }, { x: 50, y: 160 })
    expect(api.reorderCalls()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Suite 3 — axis
// ---------------------------------------------------------------------------

describe("createReorder: axis", () => {
  it("defaults to y axis (vertical drag fires swaps)", () => {
    const api = renderList(["a", "b", "c"])
    drag(api.el("a"), { x: 50, y: 50 }, { x: 50, y: 160 })
    expect(api.values()).toEqual(["b", "a", "c"])
  })

  it("respects axis: x (horizontal drag fires swaps along x)", () => {
    const api = renderList(["a", "b", "c"], "x")
    // x-axis layout: a at x=0..100, b at x=110..210, c at x=220..320.
    // a's center x=50; b's center x=160. Drag a right past 160.
    drag(api.el("a"), { x: 50, y: 50 }, { x: 170, y: 50 })
    expect(api.values()).toEqual(["b", "a", "c"])
  })

  it("axis: y ignores horizontal drag (drag axis is locked to y)", () => {
    const api = renderList(["a", "b", "c"])
    // Pure horizontal drag — no Y movement past threshold.
    drag(api.el("a"), { x: 50, y: 50 }, { x: 500, y: 50 })
    expect(api.values()).toEqual(["a", "b", "c"])
  })

  it("axis: x ignores vertical drag", () => {
    const api = renderList(["a", "b", "c"], "x")
    drag(api.el("a"), { x: 50, y: 50 }, { x: 50, y: 500 })
    expect(api.values()).toEqual(["a", "b", "c"])
  })
})

// ---------------------------------------------------------------------------
// Suite 4 — edge cases
// ---------------------------------------------------------------------------

describe("createReorder: edge cases", () => {
  it("handles empty values without throwing", () => {
    expect(() => renderList([])).not.toThrow()
  })

  it("handles a single-item list (no swap possible)", () => {
    const api = renderList(["only"])
    drag(api.el("only"), { x: 50, y: 50 }, { x: 50, y: 500 })
    expect(api.reorderCalls()).toEqual([])
    expect(api.values()).toEqual(["only"])
  })

  it("aborts the drag when the dragged value is removed externally", () => {
    const api = renderList(["a", "b", "c"])
    dragStart(api.el("a"), { x: 50, y: 50 }, { x: 50, y: 60 })
    expect(api.draggingNow()).toBe("a")
    api.setExternally(["b", "c"])
    expect(api.draggingNow()).toBe(null)
  })

  it("re-measures (does not abort) on external mutation by default", () => {
    const api = renderList(["a", "b", "c"])
    dragStart(api.el("b"), { x: 50, y: 150 }, { x: 50, y: 160 })
    expect(api.draggingNow()).toBe("b")
    // External non-dragged removal — drag continues.
    api.setExternally(["b", "c"])
    expect(api.draggingNow()).toBe("b")
    dragRelease({ x: 50, y: 160 })
    expect(api.draggingNow()).toBe(null)
  })

  it("aborts on external mutation when cancelOnExternalReorder is true", () => {
    const api = renderList(["a", "b", "c"], "y", undefined, true)
    dragStart(api.el("b"), { x: 50, y: 150 }, { x: 50, y: 160 })
    expect(api.draggingNow()).toBe("b")
    // External mutation — strict mode aborts even though b is still in array.
    api.setExternally(["c", "b", "a"])
    expect(api.draggingNow()).toBe(null)
  })

  it("does not treat primitive-internal swaps as external", () => {
    // Verify the identity-check correctly distinguishes own writes.
    const api = renderList(["a", "b", "c"])
    drag(api.el("a"), { x: 50, y: 50 }, { x: 50, y: 160 })
    // Drag completes normally (would have aborted under cancelOnExternalReorder).
    expect(api.values()).toEqual(["b", "a", "c"])
  })
})
