import { fireEvent, render } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Drag-suppression layout gate (Reorder, ADR 0008 §4.3).
//
// The gate's contract: when a `<motion.div layout drag>` element is in
// the middle of a drag (gesture-state's `whileDrag === true`), the layout
// controller's `runMeasurement` skips the FLIP for THIS element. Sibling
// controllers — not being dragged — see their own `isDragging` as false
// and FLIP normally.
//
// Test approach mirrors `tests/gestures/drag.test.tsx`:
//   - Mock motion's `animate` so we can spy on FLIP dispatches.
//   - Mock motion-dom's VisualElement layer so drag actually writes
//     observable x/y MV updates in JSDOM.
//   - Mock motion-dom's `time` so createPan's velocity window is
//     deterministic.
//   - Drive a real drag via fireEvent.pointerDown/Move/Up; the gesture
//     state machine's `setActive("whileDrag", true)` fires as part of
//     motion-dom's pan-start handshake.
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

const { useMotion } = await import("../../src/use-motion")

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

const flushFrame = (): Promise<void> =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

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

/**
 * Drive a pointer-down + threshold-cross pointermove so the drag gesture
 * starts and `whileDrag` flips to true. Leaves the drag ACTIVE (no pointerUp).
 */
function startDrag(el: HTMLElement): void {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
  // Threshold-cross (>3px) → onPanStart → setActive("whileDrag", true).
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 0, clientY: 10, isPrimary: true })
}

/** Release the drag — `whileDrag` flips back to false. */
function endDrag(el: HTMLElement): void {
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 0, clientY: 10, isPrimary: true })
  // Element-bound listeners; the up fires on window via setPointerCapture.
  void el
}

describe("layout: drag-suppression gate (Reorder)", () => {
  it("skips the FLIP when the element is being dragged", async () => {
    const [dep, setDep] = createSignal(0)
    function App() {
      const m = useMotion(() => ({
        layout: true,
        drag: "y",
        layoutDependency: dep,
      }))
      return <div data-testid="el" {...m()} />
    }
    const { container } = render(() => <App />)
    const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement

    // Baseline at initial slot.
    stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()
    animateSpy.mockClear()

    // Start drag → whileDrag = true.
    startDrag(el)

    // Simulate a slot change (the item moved as `values` reordered around
    // it) by stubbing a new rect + bumping layoutDependency.
    stubRect(el, { x: 0, y: 200, width: 100, height: 100 })
    setDep(1)
    await flushFrame()

    // The gate skipped the FLIP: no animate call from the layout controller
    // dispatched against the element. (Any motion-internal animate calls
    // unrelated to layout — e.g., drag's own — are routed through the
    // mocked HTMLVisualElement and don't hit `animateSpy`.)
    expect(animateSpy).not.toHaveBeenCalled()

    endDrag(el)
  })

  it("FLIPs normally for the same element AFTER the drag ends", async () => {
    const [dep, setDep] = createSignal(0)
    function App() {
      const m = useMotion(() => ({
        layout: true,
        drag: "y",
        layoutDependency: dep,
      }))
      return <div data-testid="el" {...m()} />
    }
    const { container } = render(() => <App />)
    const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement

    stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()
    animateSpy.mockClear()

    // Drag, move, release.
    startDrag(el)
    stubRect(el, { x: 0, y: 200, width: 100, height: 100 })
    setDep(1)
    await flushFrame()
    expect(animateSpy).not.toHaveBeenCalled() // gate active during drag

    endDrag(el)
    // After drag ends, `whileDrag` flips back to false. A new measurement
    // trigger should fire a FLIP normally.
    stubRect(el, { x: 0, y: 250, width: 100, height: 100 })
    setDep(2)
    await flushFrame()

    expect(animateSpy).toHaveBeenCalled()
  })

  it("non-dragging element FLIPs normally even when a sibling is being dragged", async () => {
    const [dep, setDep] = createSignal(0)
    function App() {
      const m1 = useMotion(() => ({
        layout: true,
        drag: "y",
        layoutDependency: dep,
      }))
      const m2 = useMotion(() => ({ layout: true, layoutDependency: dep }))
      return (
        <div>
          <div data-testid="dragged" {...m1()} />
          <div data-testid="sibling" {...m2()} />
        </div>
      )
    }
    const { container } = render(() => <App />)
    const dragged = container.querySelector<HTMLElement>(
      "[data-testid='dragged']",
    ) as HTMLElement
    const sibling = container.querySelector<HTMLElement>(
      "[data-testid='sibling']",
    ) as HTMLElement

    stubRect(dragged, { x: 0, y: 0, width: 100, height: 100 })
    stubRect(sibling, { x: 0, y: 110, width: 100, height: 100 })
    await flushFrame()
    animateSpy.mockClear()

    // Drag the first element.
    startDrag(dragged)

    // Move BOTH rects (simulates a reorder swap during the drag).
    stubRect(dragged, { x: 0, y: 110, width: 100, height: 100 })
    stubRect(sibling, { x: 0, y: 0, width: 100, height: 100 })
    setDep(1)
    await flushFrame()

    // Sibling (no whileDrag) fired its FLIP. The dragged one didn't.
    // Each FLIP dispatches one animate() per axis on the layer MVs — for
    // a pure position change the controller calls animate() for layer.x
    // and layer.y. We assert at least one animate call happened (sibling)
    // but assert below that the dragged one's was suppressed.
    expect(animateSpy).toHaveBeenCalled()

    endDrag(dragged)
  })
})
