import { fireEvent, render } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// drag-scroll — createDrag auto-scrolls a scrollable container while the
// dragged element nears its edge. See the drag-scroll glossary term + ADR
// 0008 follow-up. Scope (locked Q11): assert the scroll COORDINATION —
// arm-on-zone-entry, continuous scroll while parked, boundary self-cancel,
// disarm on release, dragScroll=false no-op, and threshold/speed overrides.
// The MV visual-continuity push is observable here too (the mock VE store is
// populated by ensureVisualElement), so we assert it as a bonus.
//
// The frame loop uses motion-dom's `frame.update(_, keepAlive)`. We mock it
// to CAPTURE the tick callback and drive it manually with a fixed delta, so
// scroll amounts are deterministic (speed_px_per_sec × delta/1000) instead of
// depending on real RAF cadence.
// ---------------------------------------------------------------------------

const { animateSpy, captured, resetCaptured, timeMock, frameLoop, veStore } = vi.hoisted(() => {
  type Write = { name: string; value: number }
  const captured: { writes: Write[]; veCreated: number } = { writes: [], veCreated: 0 }
  // Exposed so tests can reach the dragged element's MV directly (e.g. to
  // simulate a concurrent writer like createReorder's layout compensation).
  const veStore = new WeakMap<
    HTMLElement,
    { getValue: (name: string, initial: number) => { get: () => number; set: (v: number) => void } }
  >()

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

  // Captures keepAlive frame callbacks (the drag-scroll loop). `tick`
  // invokes them with a controlled delta so each frame's scroll amount is
  // deterministic.
  const callbacks = new Set<
    (data: { delta: number; timestamp: number; isProcessing: boolean }) => void
  >()
  const frameLoop = {
    callbacks,
    add: (cb: (data: { delta: number; timestamp: number; isProcessing: boolean }) => void) => {
      callbacks.add(cb)
    },
    remove: (cb: (data: { delta: number; timestamp: number; isProcessing: boolean }) => void) => {
      callbacks.delete(cb)
    },
    tick: (deltaMs: number) => {
      for (const cb of [...callbacks]) cb({ delta: deltaMs, timestamp: 0, isProcessing: false })
    },
    reset: () => callbacks.clear(),
  }

  return { animateSpy, captured, resetCaptured, timeMock, frameLoop, veStore }
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
    visualElementStore: veStore,
    time: timeMock,
    // Capture the drag-scroll keepAlive loop; delegate other frame steps to
    // the real batcher (createMotion may schedule reads/renders).
    frame: {
      ...actual.frame,
      update: vi.fn(
        (cb: (data: { delta: number; timestamp: number; isProcessing: boolean }) => void) => {
          frameLoop.add(cb)
        },
      ),
    },
    cancelFrame: vi.fn(
      (cb: (data: { delta: number; timestamp: number; isProcessing: boolean }) => void) => {
        frameLoop.remove(cb)
      },
    ),
  }
})

const { useMotion } = await import("../../src/use-motion")

beforeEach(() => {
  animateSpy.mockClear()
  resetCaptured()
  frameLoop.reset()
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
  delete (window as Partial<Window>).matchMedia
})

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

/** Give `el` a real, clamping scroll range along Y plus a bounding rect, so
 * the drag-scroll loop has something to scroll and edges to detect against.
 * The setter clamps to [0, max] like a real scroller — that's what makes the
 * boundary self-cancel observable. */
function stubScrollableY(
  el: HTMLElement,
  opts: { clientHeight: number; scrollHeight: number; top?: number; initialScroll?: number },
): { setScrollHeight: (h: number) => void } {
  const { clientHeight, top = 0 } = opts
  let scrollTop = opts.initialScroll ?? 0
  let scrollHeight = opts.scrollHeight
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    // Clamp against the CURRENT scrollHeight (a real scroller's range grows
    // when content — including a transformed child — inflates scrollHeight).
    set: (v: number) => {
      scrollTop = Math.max(0, Math.min(v, scrollHeight - clientHeight))
    },
  })
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight })
  Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight })
  el.getBoundingClientRect = () => new DOMRect(0, top, 100, clientHeight)
  return {
    setScrollHeight: (h: number) => {
      scrollHeight = h
    },
  }
}

type DraggableAPI = {
  el: HTMLElement
  container: HTMLElement
  unmount: () => void
  /** Simulate the dragged element's transform inflating the scroll area. */
  setScrollHeight: (h: number) => void
}

/** Render a vertical draggable inside a container, with the container fixed
 * as the drag-scroll target. Extra opts merge into the motion options. */
function renderDraggable(
  extraOpts: Record<string, unknown> = {},
  scroll: { clientHeight: number; scrollHeight: number; top?: number; initialScroll?: number } = {
    clientHeight: 200,
    scrollHeight: 1000,
  },
): DraggableAPI {
  let containerEl!: HTMLElement
  const { container, unmount } = render(() => {
    const m = useMotion(() => ({
      drag: "y",
      dragScrollContainer: () => containerEl,
      ...extraOpts,
    }))
    return (
      <div
        ref={(el: HTMLElement) => {
          containerEl = el
        }}
        data-testid="container"
      >
        <div {...m()} data-testid="el" />
      </div>
    )
  })
  const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
  const { setScrollHeight } = stubScrollableY(containerEl, scroll)
  return { el, container: containerEl, unmount, setScrollHeight }
}

/** Begin a y-drag and move the pointer to `clientY`. pointerdown at the
 * given start, a threshold-cross move (onPanStart), then the target move
 * (onPan → arms drag-scroll). x stays constant — drag is "y". */
function dragTo(el: HTMLElement, startY: number, clientY: number): void {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 50, clientY: startY, isPrimary: true })
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 50, clientY: startY + 5, isPrimary: true })
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 50, clientY, isPrimary: true })
}

const lastWrite = (name: "x" | "y"): number | undefined =>
  captured.writes.filter((w) => w.name === name).at(-1)?.value

// ---------------------------------------------------------------------------
// Arm + scroll
// ---------------------------------------------------------------------------

describe("drag-scroll — arming", () => {
  it("scrolls the container when the pointer enters the trailing edge zone", () => {
    // container [0,200], default threshold = min(80, 200*0.2) = 40 → bottom
    // zone [160,200]. Pointer at 200 (the edge) → full-speed ramp.
    const { el, container, unmount } = renderDraggable()
    dragTo(el, 100, 200)
    expect(container.scrollTop).toBe(0) // no frame ticked yet
    frameLoop.tick(1000) // 1s at full speed (720px/s) → 720px, clamped to max 800
    expect(container.scrollTop).toBeCloseTo(720, 0)
    unmount()
  })

  it("scrolls toward the leading edge when the pointer nears the top", () => {
    const { el, container, unmount } = renderDraggable(undefined, {
      clientHeight: 200,
      scrollHeight: 1000,
      initialScroll: 500,
    })
    dragTo(el, 100, 0) // top edge → scroll up
    frameLoop.tick(1000)
    expect(container.scrollTop).toBeLessThan(500)
    unmount()
  })

  it("does NOT arm when the pointer is in the middle (outside the edge zone)", () => {
    const { el, unmount } = renderDraggable()
    dragTo(el, 100, 100) // dead center, no zone
    expect(frameLoop.callbacks.size).toBe(0)
    unmount()
  })

  it("ramps speed by depth into the zone (closer to edge → faster)", () => {
    // Mid-zone pointer scrolls slower than an at-edge pointer for the same Δt.
    const a = renderDraggable()
    dragTo(a.el, 100, 180) // distToEnd 20, ratio 0.5
    frameLoop.tick(100)
    const midZone = a.container.scrollTop
    a.unmount()

    frameLoop.reset()
    resetCaptured()

    const b = renderDraggable()
    dragTo(b.el, 100, 200) // distToEnd 0, ratio 1
    frameLoop.tick(100)
    const atEdge = b.container.scrollTop
    b.unmount()

    expect(atEdge).toBeGreaterThan(midZone)
  })
})

// ---------------------------------------------------------------------------
// Continuous scroll + boundary
// ---------------------------------------------------------------------------

describe("drag-scroll — sustaining + boundary", () => {
  it("keeps scrolling across ticks while the pointer is parked in the zone", () => {
    const { el, container, unmount } = renderDraggable()
    dragTo(el, 100, 190)
    frameLoop.tick(100)
    const afterFirst = container.scrollTop
    expect(afterFirst).toBeGreaterThan(0)
    // No new pointer event — the self-sustaining loop ticks again.
    frameLoop.tick(100)
    expect(container.scrollTop).toBeGreaterThan(afterFirst)
    unmount()
  })

  it("self-cancels the loop when the scroll boundary is reached", () => {
    // Start one tick away from the bottom; the next tick can't move it.
    const { el, container, unmount } = renderDraggable(undefined, {
      clientHeight: 200,
      scrollHeight: 1000,
      initialScroll: 800, // already at max (1000 - 200)
    })
    dragTo(el, 100, 200) // trailing zone, but no room to scroll down
    expect(frameLoop.callbacks.size).toBe(0) // never armed — no scroll room
    expect(container.scrollTop).toBe(800)
    unmount()
  })

  it("self-cancels mid-scroll once it runs out of room", () => {
    const { el, container, unmount } = renderDraggable(undefined, {
      clientHeight: 200,
      scrollHeight: 1000,
      initialScroll: 790, // 10px of room left
    })
    dragTo(el, 100, 200)
    expect(frameLoop.callbacks.size).toBe(1) // armed (had room)
    frameLoop.tick(1000) // overshoots the 10px → clamps at 800
    expect(container.scrollTop).toBe(800)
    frameLoop.tick(1000) // this tick moves nothing → self-cancel
    expect(frameLoop.callbacks.size).toBe(0)
    unmount()
  })

  it("does not scroll past the drag-start bound when the dragged element inflates scrollHeight", () => {
    // Regression: a transformed in-flow child expands the scroll container's
    // scrollHeight. If the loop trusts the LIVE getMaxScroll(), the dragged
    // item's own downward transform keeps growing the bound → the loop never
    // reaches it → runaway (container appears to grow, item drags out the
    // bottom). The bound captured at drag-start (800 here) must cap it.
    const { el, container, setScrollHeight, unmount } = renderDraggable() // bound = 1000 - 200 = 800
    dragTo(el, 100, 200)
    frameLoop.tick(1000) // scroll toward 800 (720 this tick)
    setScrollHeight(3000) // dragged item's transform inflates the area → live max 2800
    frameLoop.tick(1000) // must clamp at the drag-start bound (800), not chase 2800
    frameLoop.tick(1000)
    expect(container.scrollTop).toBe(800)
    expect(frameLoop.callbacks.size).toBe(0) // self-cancelled at the captured bound
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Disarm on release
// ---------------------------------------------------------------------------

describe("drag-scroll — teardown", () => {
  it("stops the loop on pointer up", () => {
    const { el, unmount } = renderDraggable()
    dragTo(el, 100, 190)
    expect(frameLoop.callbacks.size).toBe(1)
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 50, clientY: 190, isPrimary: true })
    expect(frameLoop.callbacks.size).toBe(0)
    unmount()
  })

  it("stops the loop on owner disposal", () => {
    const { el, unmount } = renderDraggable()
    dragTo(el, 100, 190)
    expect(frameLoop.callbacks.size).toBe(1)
    unmount()
    expect(frameLoop.callbacks.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("drag-scroll — config", () => {
  it("dragScroll: false disables auto-scroll entirely", () => {
    const { el, container, unmount } = renderDraggable({ dragScroll: false })
    dragTo(el, 100, 200) // in the zone, but disabled
    expect(frameLoop.callbacks.size).toBe(0)
    frameLoop.tick(1000)
    expect(container.scrollTop).toBe(0)
    unmount()
  })

  it("honours an explicit dragScrollThreshold (literal px, no cap)", () => {
    // Default threshold would be 40 → pointer at 120 is NOT in the zone.
    // With threshold 100, the bottom zone is [100,200] → 120 IS in it.
    const { el, unmount } = renderDraggable({ dragScrollThreshold: 100 })
    dragTo(el, 50, 120)
    expect(frameLoop.callbacks.size).toBe(1)
    unmount()

    frameLoop.reset()
    const def = renderDraggable() // default threshold 40
    dragTo(def.el, 50, 120)
    expect(frameLoop.callbacks.size).toBe(0)
    def.unmount()
  })

  it("honours an explicit dragScrollSpeed", () => {
    const slow = renderDraggable({ dragScrollSpeed: 100 })
    dragTo(slow.el, 100, 200) // ratio 1
    frameLoop.tick(100) // 100px/s × 0.1s = 10px
    expect(slow.container.scrollTop).toBeCloseTo(10, 0)
    slow.unmount()

    frameLoop.reset()
    resetCaptured()

    const fast = renderDraggable({ dragScrollSpeed: 2000 })
    dragTo(fast.el, 100, 200)
    frameLoop.tick(100) // 2000px/s × 0.1s = 200px
    expect(fast.container.scrollTop).toBeCloseTo(200, 0)
    fast.unmount()
  })
})

// ---------------------------------------------------------------------------
// MV visual-continuity compensation (bonus — observable via the mock VE)
// ---------------------------------------------------------------------------

describe("drag-scroll — pointer tracking", () => {
  it("folds the scroll delta into the dragged element's y MV so it tracks the pointer", () => {
    const { el, container, unmount } = renderDraggable()
    // Pointer at 200 from start 100 → offset.y = 100. handlePan writes y=100
    // (scroll still 0 at that point).
    dragTo(el, 100, 200)
    expect(lastWrite("y")).toBeCloseTo(100, 0)
    // Tick scrolls the container; the loop rewrites y = offset + scrollDelta.
    frameLoop.tick(100) // 720px/s × 0.1 = 72px
    const scrolled = container.scrollTop
    expect(scrolled).toBeCloseTo(72, 0)
    expect(lastWrite("y")).toBeCloseTo(100 + scrolled, 0)
    unmount()
  })

  it("applies scroll incrementally so a concurrent MV writer is not clobbered", () => {
    // Regression: during drag-scroll, createReorder compensates for slot
    // shifts with its OWN relative write (`mv -= cumulativeLayoutDelta`) on
    // each swap. If the scroll loop recomputes the ABSOLUTE transform
    // (base + offset + cumulativeScrollDelta) every frame, it discards that
    // compensation — the dragged item drifts off-screen by the slot delta
    // (its slot stays put, leaving a gap). The loop must apply its delta
    // incrementally so a concurrent writer survives.
    const { el, unmount } = renderDraggable()
    dragTo(el, 100, 200) // offset.y = 100 → yMV 100
    frameLoop.tick(100) // +72 scroll → yMV 172
    const yMV = veStore.get(el)?.getValue("y", 0)
    if (!yMV) throw new Error("dragged element has no y MV")
    expect(yMV.get()).toBeCloseTo(172, 0)
    // Simulate createReorder's layout comp after a swap shifted the slot.
    yMV.set(yMV.get() - 50) // → 122
    // The next tick must ADD its scroll delta to the current value (→ 194),
    // NOT recompute base+offset+cumulativeScroll (which would give 244,
    // discarding the −50).
    frameLoop.tick(100) // +72 scroll
    expect(yMV.get()).toBeCloseTo(122 + 72, 0)
    unmount()
  })
})

// ---------------------------------------------------------------------------
// X axis — the same machinery on `drag: "x"` (scrollLeft / scrollWidth /
// horizontal edges). Every axis-dependent helper in createDrag branches on
// scrollAxis; these confirm the "x" arm exercises that branch end-to-end.
// ---------------------------------------------------------------------------

/** Horizontal mirror of stubScrollableY — scrollLeft range + left/right
 * bounding edges. Clamps against the current scrollWidth so the boundary
 * (and its inflation) is observable. */
function stubScrollableX(
  el: HTMLElement,
  opts: { clientWidth: number; scrollWidth: number; left?: number; initialScroll?: number },
): { setScrollWidth: (w: number) => void } {
  const { clientWidth, left = 0 } = opts
  let scrollLeft = opts.initialScroll ?? 0
  let scrollWidth = opts.scrollWidth
  Object.defineProperty(el, "scrollLeft", {
    configurable: true,
    get: () => scrollLeft,
    set: (v: number) => {
      scrollLeft = Math.max(0, Math.min(v, scrollWidth - clientWidth))
    },
  })
  Object.defineProperty(el, "scrollWidth", { configurable: true, get: () => scrollWidth })
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth })
  el.getBoundingClientRect = () => new DOMRect(left, 0, clientWidth, 100)
  return {
    setScrollWidth: (w: number) => {
      scrollWidth = w
    },
  }
}

type DraggableXAPI = {
  el: HTMLElement
  container: HTMLElement
  unmount: () => void
  setScrollWidth: (w: number) => void
}

function renderDraggableX(
  extraOpts: Record<string, unknown> = {},
  scroll: { clientWidth: number; scrollWidth: number; left?: number; initialScroll?: number } = {
    clientWidth: 200,
    scrollWidth: 1000,
  },
): DraggableXAPI {
  let containerEl!: HTMLElement
  const { container, unmount } = render(() => {
    const m = useMotion(() => ({
      drag: "x",
      dragScrollContainer: () => containerEl,
      ...extraOpts,
    }))
    return (
      <div
        ref={(el: HTMLElement) => {
          containerEl = el
        }}
        data-testid="container"
      >
        <div {...m()} data-testid="el" />
      </div>
    )
  })
  const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
  const { setScrollWidth } = stubScrollableX(containerEl, scroll)
  return { el, container: containerEl, unmount, setScrollWidth }
}

/** Begin an x-drag and move the pointer to `clientX`; y stays constant. */
function dragToX(el: HTMLElement, startX: number, clientX: number): void {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: startX, clientY: 50, isPrimary: true })
  fireEvent.pointerMove(window, { pointerId: 1, clientX: startX + 5, clientY: 50, isPrimary: true })
  fireEvent.pointerMove(window, { pointerId: 1, clientX, clientY: 50, isPrimary: true })
}

describe("drag-scroll — x axis", () => {
  it("scrolls right when the pointer enters the trailing (right) edge zone", () => {
    // container [0,200], threshold min(80, 40) = 40 → right zone [160,200].
    const { el, container, unmount } = renderDraggableX()
    dragToX(el, 100, 200) // at the right edge → full-speed ramp
    expect(container.scrollLeft).toBe(0)
    frameLoop.tick(1000) // 720px/s × 1s = 720, clamped to max 800
    expect(container.scrollLeft).toBeCloseTo(720, 0)
    unmount()
  })

  it("scrolls left when the pointer nears the leading edge", () => {
    const { el, container, unmount } = renderDraggableX(undefined, {
      clientWidth: 200,
      scrollWidth: 1000,
      initialScroll: 500,
    })
    dragToX(el, 100, 0) // left edge → scroll left
    frameLoop.tick(1000)
    expect(container.scrollLeft).toBeLessThan(500)
    unmount()
  })

  it("does not arm in the middle (outside the edge zone)", () => {
    const { el, unmount } = renderDraggableX()
    dragToX(el, 100, 100)
    expect(frameLoop.callbacks.size).toBe(0)
    unmount()
  })

  it("folds the scroll delta into the dragged element's x MV", () => {
    const { el, container, unmount } = renderDraggableX()
    dragToX(el, 100, 200) // offset.x = 100 → xMV 100
    expect(lastWrite("x")).toBeCloseTo(100, 0)
    frameLoop.tick(100) // +72 scroll
    const scrolled = container.scrollLeft
    expect(scrolled).toBeCloseTo(72, 0)
    expect(lastWrite("x")).toBeCloseTo(100 + scrolled, 0)
    unmount()
  })

  it("clamps to the drag-start bound when the dragged element inflates scrollWidth", () => {
    const { el, container, setScrollWidth, unmount } = renderDraggableX() // bound 800
    dragToX(el, 100, 200)
    frameLoop.tick(1000)
    setScrollWidth(3000) // transform inflates the horizontal scroll area
    frameLoop.tick(1000)
    frameLoop.tick(1000)
    expect(container.scrollLeft).toBe(800)
    expect(frameLoop.callbacks.size).toBe(0)
    unmount()
  })

  it("dragScroll: false disables horizontal auto-scroll", () => {
    const { el, container, unmount } = renderDraggableX({ dragScroll: false })
    dragToX(el, 100, 200)
    expect(frameLoop.callbacks.size).toBe(0)
    frameLoop.tick(1000)
    expect(container.scrollLeft).toBe(0)
    unmount()
  })
})
