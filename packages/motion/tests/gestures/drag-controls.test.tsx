import { fireEvent, render } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DragControls } from "../../src/types"

// Reuse the drag-test mocks for motion.animate + motion-dom VE so we can
// inspect x/y MV writes from externally-initiated drag sessions.
const { animateSpy, captured, resetCaptured } = vi.hoisted(() => {
  type Write = { name: string; value: number }
  const captured: { writes: Write[] } = { writes: [] }
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
  }
  return { animateSpy, captured, resetCaptured }
})

vi.mock("motion", async () => {
  const actual = await vi.importActual<typeof import("motion")>("motion")
  return { ...actual, animate: animateSpy }
})

vi.mock("motion-dom", async () => {
  const actual = await vi.importActual<typeof import("motion-dom")>("motion-dom")

  type MockMV = {
    _value: number
    get: () => number
    set: (v: number) => void
    stop: () => void
    on: () => () => void
    getVelocity: () => number
  }

  function makeMockMV(name: string, initial: number): MockMV {
    const mv: MockMV = {
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
  }
})

const { useMotion } = await import("../../src/use-motion")
const { createDragControls } = await import("../../src/primitives/createDragControls")

beforeEach(() => {
  animateSpy.mockClear()
  resetCaptured()
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
  delete (window as Partial<Window>).matchMedia
})

// ---------------------------------------------------------------------------
// Factory API
// ---------------------------------------------------------------------------

describe("createDragControls — factory", () => {
  it("returns an object with a single enumerable `start` method", () => {
    const controls = createDragControls()
    expect(typeof controls.start).toBe("function")
    expect(Object.keys(controls)).toEqual(["start"])
  })

  it("start() is a safe no-op when no motion element is registered", () => {
    const controls = createDragControls()
    const event = new PointerEvent("pointerdown", {
      pointerId: 1,
      clientX: 10,
      clientY: 5,
      isPrimary: true,
    })
    // Calling start with no binding should NOT throw and NOT touch the DOM.
    expect(() => controls.start(event)).not.toThrow()
    expect(captured.writes).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Registration + external drag flow
// ---------------------------------------------------------------------------

describe("createDragControls — external drag", () => {
  function setup(opts: { snapToCursor?: boolean } = {}): {
    controls: DragControls
    draggable: HTMLElement
    handle: HTMLElement
    unmount: () => void
  } {
    const controls = createDragControls()
    let draggable!: HTMLElement
    let handle!: HTMLElement
    const { unmount } = render(() => {
      const m = useMotion({ drag: true, dragControls: controls })
      return (
        <div>
          <div {...m()} ref={(el) => (draggable = el)} />
          <button
            type="button"
            ref={(el) => (handle = el)}
            onPointerDown={(e) => controls.start(e, opts)}
          >
            handle
          </button>
        </div>
      )
    })
    return { controls, draggable, handle, unmount }
  }

  it("forwards a handle's pointerdown into a drag session on the dragged element", () => {
    const { handle, unmount } = setup()

    // pointerdown on the HANDLE, NOT the draggable. No threshold gate
    // applies — controls.start initiates drag at this pointer position.
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 50, isPrimary: true })
    // A pointermove (on window) is the FIRST real-motion event after the
    // synthesized handlePanStart — fires onPan with offset relative to (100,50).
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 150, clientY: 80, isPrimary: true })

    // The drag handler wrote to x/y MVs: offset from (100,50) → (150,80) is (50, 30).
    const xWrites = captured.writes.filter((w) => w.name === "x")
    const yWrites = captured.writes.filter((w) => w.name === "y")
    expect(xWrites.at(-1)?.value).toBe(50)
    expect(yWrites.at(-1)?.value).toBe(30)
    unmount()
  })

  it("bypasses the pan threshold — no minimum movement required before drag begins", () => {
    // Default panThreshold is 3; the FIRST pointermove (at 1px) is below
    // threshold for createPan-based drags. For controls.start, threshold
    // is bypassed: drag is engaged immediately on start(), so even a 1px
    // pointermove fires onPan → MV write.
    const { handle, unmount } = setup()

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 1, clientY: 0, isPrimary: true })

    const xWrites = captured.writes.filter((w) => w.name === "x")
    expect(xWrites.at(-1)?.value).toBe(1)
    unmount()
  })

  it("pointerup ends the session and stops further moves from registering", () => {
    const { handle, unmount } = setup()

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 0, isPrimary: true })
    expect(captured.writes.filter((w) => w.name === "x").at(-1)?.value).toBe(10)

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 0, isPrimary: true })
    captured.writes = [] // baseline post-end

    // Further moves on window should NOT cause writes — session ended.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 30, clientY: 0, isPrimary: true })
    expect(captured.writes).toEqual([])
    unmount()
  })
})

// ---------------------------------------------------------------------------
// snapToCursor
// ---------------------------------------------------------------------------

describe("createDragControls — snapToCursor", () => {
  it("snaps the element's center to the pointer position on start", () => {
    const controls = createDragControls()
    let draggable!: HTMLElement
    let handle!: HTMLElement
    const { unmount } = render(() => {
      const m = useMotion({ drag: true, dragControls: controls })
      return (
        <div>
          <div {...m()} ref={(el) => (draggable = el)} />
          <button
            type="button"
            ref={(el) => (handle = el)}
            onPointerDown={(e) => controls.start(e, { snapToCursor: true })}
          >
            handle
          </button>
        </div>
      )
    })
    // Stub the draggable's rect — jsdom gives 0-rects without layout.
    draggable.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 40,
        bottom: 20,
        width: 40,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => "",
      }) as DOMRect

    // Pointer at (200, 100). Element's center is at (20, 10) (rect 40x20 at origin).
    // Snap delta = (200 - 20, 100 - 10) = (180, 90). x/y MVs start at 0 →
    // snap writes (180, 90) to xMV/yMV BEFORE drag begins.
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 200, clientY: 100, isPrimary: true })

    const xWrites = captured.writes.filter((w) => w.name === "x")
    const yWrites = captured.writes.filter((w) => w.name === "y")
    expect(xWrites.at(-1)?.value).toBe(180)
    expect(yWrites.at(-1)?.value).toBe(90)
    unmount()
  })

  it("subsequent moves accumulate from the snapped position", () => {
    const controls = createDragControls()
    let draggable!: HTMLElement
    let handle!: HTMLElement
    const { unmount } = render(() => {
      const m = useMotion({ drag: true, dragControls: controls })
      return (
        <div>
          <div {...m()} ref={(el) => (draggable = el)} />
          <button
            type="button"
            ref={(el) => (handle = el)}
            onPointerDown={(e) => controls.start(e, { snapToCursor: true })}
          >
            handle
          </button>
        </div>
      )
    })
    draggable.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 40,
        bottom: 20,
        width: 40,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => "",
      }) as DOMRect

    // Snap puts element center at (200, 100). dragStartX after snap = 180.
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 200, clientY: 100, isPrimary: true })
    // Pointer move 10px right → offset 10 → MV value = 180 + 10 = 190.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 210, clientY: 100, isPrimary: true })

    const xWrites = captured.writes.filter((w) => w.name === "x")
    expect(xWrites.at(-1)?.value).toBe(190)
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Drag lifecycle callbacks fire for external sessions
// ---------------------------------------------------------------------------

describe("createDragControls — drag callbacks", () => {
  it("fires onDragStart, onDrag, onDragEnd for an externally-initiated session", () => {
    const onDragStart = vi.fn()
    const onDrag = vi.fn()
    const onDragEnd = vi.fn()
    const controls = createDragControls()
    let handle!: HTMLElement
    const { unmount } = render(() => {
      const m = useMotion({
        drag: true,
        dragControls: controls,
        onDragStart,
        onDrag,
        onDragEnd,
      })
      return (
        <div>
          <div {...m()} />
          <button
            type="button"
            ref={(el) => (handle = el)}
            onPointerDown={(e) => controls.start(e)}
          >
            handle
          </button>
        </div>
      )
    })

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    expect(onDragStart).toHaveBeenCalledOnce()

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY: 0, isPrimary: true })
    expect(onDrag).toHaveBeenCalledTimes(2)

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 20, clientY: 0, isPrimary: true })
    expect(onDragEnd).toHaveBeenCalledOnce()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Registration lifecycle: last-mount-wins, clean unregister
// ---------------------------------------------------------------------------

describe("createDragControls — registration", () => {
  it("last-mounted motion element wins when two register with the same controls", () => {
    const controls = createDragControls()
    const onDragStart1 = vi.fn()
    const onDragStart2 = vi.fn()

    const { unmount } = render(() => {
      const m1 = useMotion({ drag: true, dragControls: controls, onDragStart: onDragStart1 })
      const m2 = useMotion({ drag: true, dragControls: controls, onDragStart: onDragStart2 })
      return (
        <div>
          <div {...m1()} data-which="first" />
          <div {...m2()} data-which="second" />
        </div>
      )
    })

    const event = new PointerEvent("pointerdown", {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      isPrimary: true,
    })
    controls.start(event)

    // Only the second element's onDragStart fires — last registration wins.
    expect(onDragStart1).not.toHaveBeenCalled()
    expect(onDragStart2).toHaveBeenCalledOnce()
    unmount()
  })

  it("start() is a no-op after the registered element unmounts", () => {
    const controls = createDragControls()
    const onDragStart = vi.fn()

    const { unmount } = render(() => {
      const m = useMotion({ drag: true, dragControls: controls, onDragStart })
      return <div {...m()} />
    })
    unmount()

    const event = new PointerEvent("pointerdown", {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      isPrimary: true,
    })
    expect(() => controls.start(event)).not.toThrow()
    expect(onDragStart).not.toHaveBeenCalled()
  })
})
