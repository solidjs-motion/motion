import { fireEvent, render } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Hoisted state — vi.mock factories below close over these refs, and tests
// inspect them to verify drag wrote to the right MVs.
const { animateSpy, captured, resetCaptured } = vi.hoisted(() => {
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

  return { animateSpy, captured, resetCaptured }
})

vi.mock("motion", async () => {
  const actual = await vi.importActual<typeof import("motion")>("motion")
  return { ...actual, animate: animateSpy }
})

// Mock motion-dom's VisualElement layer so we can spy on x/y MV writes. We
// keep the rest of motion-dom (hover, press, time, isPrimaryPointer, etc.)
// intact via `...actual` so other gestures behave normally.
vi.mock("motion-dom", async () => {
  const actual = await vi.importActual<typeof import("motion-dom")>("motion-dom")

  type MockMV = {
    _name: string
    _value: number
    get: () => number
    set: (v: number) => void
    stop: () => void
    on: () => () => void
    // motion-dom checks getVelocity to duck-type MVs; provide a stub.
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
  }
})

const { useMotion } = await import("../../src/use-motion")

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

/** Convenience: drive the pointer through a pan session.
 *
 * createPan's first pointermove fires `onPanStart` (NOT `onPan`) once the
 * threshold is crossed — no MV writes happen on that move. To get drag to
 * actually write to x/y MVs, we need at least TWO moves: a threshold-cross
 * followed by a real onPan. This helper fires the threshold-cross
 * automatically at (5, 0), then each user-supplied move as an onPan event.
 */
function drag(el: HTMLElement, ...moves: Array<{ x: number; y: number }>): void {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
  // Threshold-cross move (5px > default 3px threshold) → onPanStart.
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })
  // Each subsequent move fires onPan, which is where MV writes happen.
  for (const m of moves) {
    fireEvent.pointerMove(window, { pointerId: 1, clientX: m.x, clientY: m.y, isPrimary: true })
  }
  // Up at last user-supplied position (or the threshold-cross position).
  const last = moves.at(-1) ?? { x: 5, y: 0 }
  fireEvent.pointerUp(window, { pointerId: 1, clientX: last.x, clientY: last.y, isPrimary: true })
}

// ---------------------------------------------------------------------------
// Drag enabled / disabled
// ---------------------------------------------------------------------------

describe("drag — enable check", () => {
  it("does NOT write to x/y MVs when drag is not enabled", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { opacity: 1 } })
      return <div {...m()} data-testid="el" />
    })
    const el = container.firstChild as HTMLElement

    drag(el, { x: 50, y: 30 })

    expect(captured.writes).toEqual([])
    unmount()
  })

  it("writes to x/y MVs when drag: true is set", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true })
      return <div {...m()} data-testid="el" />
    })
    const el = container.firstChild as HTMLElement

    drag(el, { x: 5, y: 0 }, { x: 50, y: 30 })

    // Pointermove (5, 0) crosses the 3px threshold and starts drag.
    // Both x and y are written (default axis = both).
    const xWrites = captured.writes.filter((w) => w.name === "x")
    const yWrites = captured.writes.filter((w) => w.name === "y")
    expect(xWrites.length).toBeGreaterThan(0)
    expect(yWrites.length).toBeGreaterThan(0)
    // Last x write equals last move's offset (no constraints).
    expect(xWrites.at(-1)?.value).toBe(50)
    expect(yWrites.at(-1)?.value).toBe(30)
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Axis lock
// ---------------------------------------------------------------------------

describe("drag — axis lock", () => {
  it("drag='x' writes only x, never y", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: "x" })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    drag(el, { x: 50, y: 30 })

    expect(captured.writes.some((w) => w.name === "x")).toBe(true)
    expect(captured.writes.some((w) => w.name === "y")).toBe(false)
    unmount()
  })

  it("drag='y' writes only y, never x", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: "y" })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    drag(el, { x: 50, y: 30 })

    expect(captured.writes.some((w) => w.name === "y")).toBe(true)
    expect(captured.writes.some((w) => w.name === "x")).toBe(false)
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

describe("drag — constraints", () => {
  it("numeric constraints clamp x/y to absolute MV bounds", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({
        drag: true,
        dragConstraints: { left: -10, right: 20, top: -5, bottom: 15 },
        dragElastic: 0, // hard clamp for deterministic test
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    drag(el, { x: 50, y: 50 })

    const xWrites = captured.writes.filter((w) => w.name === "x")
    const yWrites = captured.writes.filter((w) => w.name === "y")
    // Hard clamp (elastic 0): final write equals upper bound.
    expect(xWrites.at(-1)?.value).toBe(20)
    expect(yWrites.at(-1)?.value).toBe(15)
    unmount()
  })

  it("numeric constraints with a missing side leave that side unbounded", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({
        drag: true,
        // Only left/right set; top/bottom unbounded.
        dragConstraints: { left: 0, right: 100 },
        dragElastic: 0,
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    drag(el, { x: 5, y: -50 })

    const yWrites = captured.writes.filter((w) => w.name === "y")
    // No top bound → y can go to -50.
    expect(yWrites.at(-1)?.value).toBe(-50)
    unmount()
  })

  it("element constraint resolves bounds from container's rect", () => {
    // jsdom returns 0-rects by default; stub getBoundingClientRect on both.
    let containerEl!: HTMLDivElement
    const { container, unmount } = render(() => {
      const m = useMotion({
        drag: true,
        dragConstraints: () => containerEl,
        dragElastic: 0,
      })
      return (
        <div ref={(r) => (containerEl = r)} style={{ width: "200px", height: "100px" }}>
          <div {...m()} />
        </div>
      )
    })
    // Navigate the tree explicitly: render's container > our wrapping div >
    // the motion-controlled div. `querySelector("div > div")` would match
    // the outer wrapper first (parent is render's container, also a div).
    const outer = container.firstChild as HTMLElement
    const draggable = outer.firstChild as HTMLElement

    // Stub rects: container is 200x100 at (0,0); draggable is 50x50 at (0,0).
    containerEl.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 200,
        bottom: 100,
        width: 200,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => "",
      }) as DOMRect
    draggable.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 50,
        bottom: 50,
        width: 50,
        height: 50,
        x: 0,
        y: 0,
        toJSON: () => "",
      }) as DOMRect

    drag(draggable, { x: 500, y: 500 })

    const xWrites = captured.writes.filter((w) => w.name === "x")
    const yWrites = captured.writes.filter((w) => w.name === "y")
    // Bounds: maxX = container.right - draggable.right = 200 - 50 = 150
    //         maxY = container.bottom - draggable.bottom = 100 - 50 = 50
    expect(xWrites.at(-1)?.value).toBe(150)
    expect(yWrites.at(-1)?.value).toBe(50)
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Elastic resistance
// ---------------------------------------------------------------------------

describe("drag — elastic resistance", () => {
  it("default elastic 0.5 halves overflow past bounds", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({
        drag: true,
        dragConstraints: { left: -10, right: 20 },
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    drag(el, { x: 40, y: 0 })

    // Candidate x = 40; max = 20; overflow = 20.
    // Elastic 0.5 → final = 20 + 20 × 0.5 = 30.
    const xWrites = captured.writes.filter((w) => w.name === "x")
    expect(xWrites.at(-1)?.value).toBe(30)
    unmount()
  })

  it("custom elastic 0.25 quarters overflow", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({
        drag: true,
        dragConstraints: { right: 20 },
        dragElastic: 0.25,
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    drag(el, { x: 60, y: 0 })

    // Overflow = 60 - 20 = 40; elastic 0.25 → final = 20 + 40 × 0.25 = 30.
    const xWrites = captured.writes.filter((w) => w.name === "x")
    expect(xWrites.at(-1)?.value).toBe(30)
    unmount()
  })

  it("elastic resistance applies symmetrically below min", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({
        drag: true,
        dragConstraints: { left: -10 },
        dragElastic: 0.5,
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    drag(el, { x: -40, y: 0 })

    // Candidate x = -40; min = -10; overflow = -30 (below min by 30).
    // Elastic 0.5 → final = -10 + (-30) × 0.5 = -25.
    const xWrites = captured.writes.filter((w) => w.name === "x")
    expect(xWrites.at(-1)?.value).toBe(-25)
    unmount()
  })
})

// ---------------------------------------------------------------------------
// whileDrag state composition (Q5/C-lean)
// ---------------------------------------------------------------------------

describe("drag — whileDrag state composition", () => {
  it("activates whileDrag target (e.g., scale) on threshold cross", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({
        animate: { scale: 1 },
        drag: true,
        whileDrag: { scale: 1.1 },
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    animateSpy.mockClear()

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })

    // State machine fired animate with scale=1.1 (whileDrag's target).
    const scaleCall = animateSpy.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.scale === 1.1,
    )
    expect(scaleCall).toBeDefined()
    unmount()
  })

  it("deactivates whileDrag on pointerup — scale reverts to animate's value", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({
        animate: { scale: 1 },
        drag: true,
        whileDrag: { scale: 1.1 },
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    drag(el, { x: 5, y: 0 })

    const lastScaleCall = animateSpy.mock.calls
      .filter((c) => (c[1] as Record<string, unknown>)?.scale !== undefined)
      .at(-1)
    expect(lastScaleCall?.[1]).toMatchObject({ scale: 1 })
    unmount()
  })

  it("filters x/y from animate target when drag is enabled (Q5/C-lean)", () => {
    // animate target has x: 100, but drag owns x. The state machine's
    // animate call should NOT contain x.
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { x: 100, opacity: 1 }, drag: true })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    // Verify motion's animate spy was called WITHOUT x in any call.
    for (const call of animateSpy.mock.calls) {
      const target = call[1] as Record<string, unknown> | undefined
      if (target) expect(target.x).toBeUndefined()
    }
    // opacity should still flow through.
    const opacityCall = animateSpy.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.opacity === 1,
    )
    expect(opacityCall).toBeDefined()
    unmount()
    // Suppress "el unused" lint — the test renders it.
    void el
  })
})

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

describe("drag — callbacks", () => {
  it("fires onDragStart at threshold cross", () => {
    const onDragStart = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true, onDragStart })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })

    expect(onDragStart).toHaveBeenCalledOnce()
    unmount()
  })

  it("fires onDrag on each move after onDragStart", () => {
    const onDrag = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true, onDrag })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    // drag helper injects an initial threshold-cross move (onPanStart);
    // each subsequent user-supplied move fires onPan → drag's onDrag.
    drag(el, { x: 10, y: 0 }, { x: 15, y: 0 })

    expect(onDrag).toHaveBeenCalledTimes(2)
    unmount()
  })

  it("fires onDragEnd on pointerup", () => {
    const onDragEnd = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true, onDragEnd })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    drag(el, { x: 10, y: 0 })

    expect(onDragEnd).toHaveBeenCalledOnce()
    unmount()
  })

  it("fires onDragTransitionEnd sync when dragMomentum is false", () => {
    const onDragTransitionEnd = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true, dragMomentum: false, onDragTransitionEnd })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    drag(el, { x: 10, y: 0 })

    expect(onDragTransitionEnd).toHaveBeenCalledOnce()
    unmount()
  })

  it("fires onDragTransitionEnd after momentum settles (animate Promise.all)", async () => {
    const onDragTransitionEnd = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true, onDragTransitionEnd })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    drag(el, { x: 10, y: 0 })

    // animate spy's then() resolves synchronously, so Promise.all over two
    // thenables resolves through ~3 microtask hops. Flush via setTimeout(0)
    // which yields a task tick (catches all pending microtasks).
    await new Promise((r) => setTimeout(r, 0))
    expect(onDragTransitionEnd).toHaveBeenCalledOnce()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Momentum
// ---------------------------------------------------------------------------

describe("drag — momentum", () => {
  it("default dragMomentum=true triggers inertia animate calls per axis", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    drag(el, { x: 10, y: 5 })

    // Two inertia animate calls expected — one per axis. animate spy is
    // called with (mv, target, opts); opts.type === "inertia".
    const inertiaCalls = animateSpy.mock.calls.filter(
      (c) => (c[2] as Record<string, unknown> | undefined)?.type === "inertia",
    )
    expect(inertiaCalls.length).toBe(2)
    unmount()
  })

  it("dragMomentum=false does NOT trigger inertia animate calls", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true, dragMomentum: false })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    drag(el, { x: 10, y: 5 })

    const inertiaCalls = animateSpy.mock.calls.filter(
      (c) => (c[2] as Record<string, unknown> | undefined)?.type === "inertia",
    )
    expect(inertiaCalls.length).toBe(0)
    unmount()
  })

  it("dragSnapToOrigin triggers inertia animate with min: 0, max: 0", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true, dragSnapToOrigin: true })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    drag(el, { x: 50, y: 30 })

    const snapCalls = animateSpy.mock.calls.filter((c) => {
      const opts = c[2] as Record<string, unknown> | undefined
      return opts?.type === "inertia" && opts?.min === 0 && opts?.max === 0
    })
    expect(snapCalls.length).toBe(2)
    unmount()
  })

  it("user's dragTransition overrides default fields (e.g., bounceStiffness)", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({
        drag: true,
        dragTransition: { bounceStiffness: 200 },
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    drag(el, { x: 10, y: 5 })

    const overrideCalls = animateSpy.mock.calls.filter(
      (c) => (c[2] as Record<string, unknown> | undefined)?.bounceStiffness === 200,
    )
    expect(overrideCalls.length).toBe(2)
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Body styles + pointer capture
// ---------------------------------------------------------------------------

describe("drag — body styles and pointer capture", () => {
  it("sets document.body.style.userSelect=none during drag, restores after", () => {
    document.body.style.userSelect = "text" // pre-existing user value
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })
    expect(document.body.style.userSelect).toBe("none")

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })
    // Restored to PRE-drag value, not stripped.
    expect(document.body.style.userSelect).toBe("text")
    document.body.style.userSelect = ""
    unmount()
  })

  it("sets touch-action based on drag axis", () => {
    const cases: Array<{ drag: boolean | "x" | "y"; expected: string }> = [
      { drag: true, expected: "none" },
      { drag: "x", expected: "pan-y" },
      { drag: "y", expected: "pan-x" },
    ]
    for (const c of cases) {
      const { container, unmount } = render(() => {
        const m = useMotion({ drag: c.drag })
        return <div {...m()} />
      })
      const el = container.firstChild as HTMLElement
      fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })
      expect(el.style.touchAction).toBe(c.expected)
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })
      unmount()
    }
  })

  it("calls setPointerCapture on drag-start and releasePointerCapture on end", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    el.setPointerCapture = vi.fn()
    el.releasePointerCapture = vi.fn()

    drag(el, { x: 10, y: 0 })

    expect(el.setPointerCapture).toHaveBeenCalledWith(1)
    expect(el.releasePointerCapture).toHaveBeenCalledWith(1)
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Reactive opts (the function-form path we explicitly designed for)
// ---------------------------------------------------------------------------

describe("drag — reactive opts", () => {
  it("toggling opts.drag off mid-life stops drag from engaging on next session", () => {
    const [dragEnabled, setDragEnabled] = createSignal(true)
    const { container, unmount } = render(() => {
      const m = useMotion(() => ({ drag: dragEnabled() }))
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    drag(el, { x: 10, y: 0 })
    const writesBefore = captured.writes.length
    expect(writesBefore).toBeGreaterThan(0)

    setDragEnabled(false)
    captured.writes = []

    drag(el, { x: 10, y: 0 })
    expect(captured.writes.length).toBe(0)
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

describe("drag — cleanup", () => {
  it("restores body userSelect when unmount happens mid-drag", () => {
    document.body.style.userSelect = "text"
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })
    expect(document.body.style.userSelect).toBe("none")

    unmount() // dispose mid-drag

    expect(document.body.style.userSelect).toBe("text")
    document.body.style.userSelect = ""
  })

  it("stops in-flight momentum animations on unmount", () => {
    const stopSpies: Array<ReturnType<typeof vi.fn>> = []
    animateSpy.mockImplementation(() => {
      const stop = vi.fn()
      stopSpies.push(stop)
      return {
        stop,
        pause: vi.fn(),
        play: vi.fn(),
        cancel: vi.fn(),
        complete: vi.fn(),
        // Don't auto-resolve `then` — keep "momentum in flight" until unmount.
        // biome-ignore lint/suspicious/noThenProperty: motion's AnimationPlaybackControls is intentionally thenable
        then: () => Promise.resolve(),
      } as unknown as ReturnType<typeof animateSpy>
    })

    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    drag(el, { x: 10, y: 5 })

    // Two momentum animations created (one per axis). Both stops fired on
    // unmount via stopMomentum().
    const momentumStops = stopSpies.slice(-2)
    expect(momentumStops.length).toBe(2)

    unmount()

    expect(momentumStops[0]).toHaveBeenCalled()
    expect(momentumStops[1]).toHaveBeenCalled()
  })
})
