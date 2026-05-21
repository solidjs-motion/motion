import { fireEvent, render } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Hoisted state — vi.mock factories below close over these refs, and tests
// inspect them to verify drag wrote to the right MVs.
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

  // motion-dom's `time` drives createPan's velocity sliding window. Tests
  // that need a deterministic non-zero velocity advance this between pointer
  // events so dt > 0 in the velocity calc.
  const timeMock = { now: vi.fn(() => 0) }

  return { animateSpy, captured, resetCaptured, timeMock }
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
    // Pass our mock through so tests can drive createPan's velocity window.
    time: timeMock,
  }
})

const { useMotion } = await import("../../src/use-motion")

beforeEach(() => {
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
  delete (window as Partial<Window>).matchMedia
})

/** Advance the mocked clock so createPan's velocity calc sees a non-zero dt. */
function setNow(ms: number) {
  timeMock.now.mockReturnValue(ms)
}

/** Drive a drag sequence with manual time advances between moves so the
 * velocity sliding window produces a deterministic non-zero release velocity.
 * Each tuple is { x, y, t } — t advances the time mock before the pointermove
 * fires, controlling the sample's timestamp. */
function dragWithTime(el: HTMLElement, moves: Array<{ x: number; y: number; t: number }>): void {
  setNow(0)
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
  // Threshold-cross at t=1, (5, 0).
  setNow(1)
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })
  let last = { x: 5, y: 0, t: 1 }
  for (const m of moves) {
    setNow(m.t)
    fireEvent.pointerMove(window, { pointerId: 1, clientX: m.x, clientY: m.y, isPrimary: true })
    last = m
  }
  setNow(last.t)
  fireEvent.pointerUp(window, { pointerId: 1, clientX: last.x, clientY: last.y, isPrimary: true })
}

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

  it("sets a drag-friendly touch-action at render time so mobile browsers don't pre-cancel the gesture", () => {
    // Regression: without an upfront touch-action, mobile browsers arbitrate
    // the gesture as native scroll/zoom and fire pointercancel before
    // motion's own handlePanStart writes touch-action. Result on touch
    // devices: missed drags or panEnd dispatched with stale offset data
    // (e.g. an immediate swipe-stack card dismiss on touch).
    //
    // axis "x" → pan-y (browser keeps vertical scroll free), "y" → pan-x,
    // unspecified (drag: true) → none.
    const cases: Array<[true | "x" | "y", string]> = [
      [true, "none"],
      ["x", "pan-y"],
      ["y", "pan-x"],
    ]
    for (const [drag, expected] of cases) {
      const { container, unmount } = render(() => {
        const m = useMotion({ drag })
        return <div {...m()} />
      })
      const el = container.firstChild as HTMLElement
      expect(el.style.touchAction, `drag=${String(drag)}`).toBe(expected)
      unmount()
    }
  })

  it("does NOT set a touch-action default when drag is absent", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { opacity: 1 } })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    expect(el.style.touchAction).toBe("")
    unmount()
  })

  it("user-supplied style.touch-action overrides motion's drag default", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: "x" })
      // User opts back into the browser's default scroll arbitration.
      return <div {...m({ style: { "touch-action": "auto" } })} />
    })
    const el = container.firstChild as HTMLElement
    expect(el.style.touchAction).toBe("auto")
    unmount()
  })

  it("dragListener:false skips motion's own pointer listener — element stays inert", () => {
    // Regression: a scrollable surface (drawer body, sheet, etc.) that
    // wants drag-to-close via a SEPARATE handle should not initiate drag
    // from direct pointer interaction on its own body. With
    // `dragListener: false`, motion skips attaching its pan-session
    // listener to the element entirely — only dragControls.start(e)
    // from a handle elsewhere can begin a drag.
    const onDragStart = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true, dragListener: false, onDragStart })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    // Synthetic drag on the element itself — without dragListener:false
    // this would write to x/y MVs and fire onDragStart. With it, NONE
    // of those should happen.
    drag(el, { x: 5, y: 0 }, { x: 50, y: 30 })

    expect(captured.writes).toEqual([])
    expect(onDragStart).not.toHaveBeenCalled()
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

  it("drag='x' skips release-momentum on the locked y axis (regression)", () => {
    // Without the fix, `animate()` is still called on yMV on pan-end even
    // though drag never wrote to it — pointer y velocity feeds an inertia
    // decay that drifts the locked axis after release. Animate is mocked
    // here so we assert on the call shape rather than the resulting value.
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: "x", dragMomentum: true })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    // Drag with non-zero vertical pointer movement — both axes have velocity,
    // but `drag: "x"` means only x should ever receive an animate call.
    drag(el, { x: 60, y: 60 }, { x: 120, y: 100 })

    // Filter to animate calls produced by the momentum/release path. The
    // mock's args are (value, target, transition). MV refs are the mock
    // objects from makeMockMV; we identify them by `_name`.
    const momentumYCalls = animateSpy.mock.calls.filter((call) => {
      const value = call[0] as { _name?: string } | undefined
      return value?._name === "y"
    })
    expect(momentumYCalls).toHaveLength(0)
    unmount()
  })

  it("drag='y' skips release-momentum on the locked x axis (regression)", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: "y", dragMomentum: true })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    drag(el, { x: 60, y: 60 }, { x: 100, y: 120 })

    const momentumXCalls = animateSpy.mock.calls.filter((call) => {
      const value = call[0] as { _name?: string } | undefined
      return value?._name === "x"
    })
    expect(momentumXCalls).toHaveLength(0)
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

  it("zeros release-velocity into bounds when elastic=0 and value is at the bound", () => {
    // Even with overdamped bounce, inertia still computes one frame of
    // overshoot value before the spring snaps back — visibly flickering.
    // When the user releases AT the boundary with outward velocity, the
    // cleanest fix is to zero the velocity feeding inertia: with no
    // velocity there's no decay step and no overshoot frame.
    const { container, unmount } = render(() => {
      const m = useMotion({
        drag: "x",
        dragConstraints: { left: -10, right: 20 },
        dragElastic: 0,
        dragMomentum: true,
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    // Drag past the right bound (applyElastic clamps to 20). Time advances
    // between moves so the velocity sliding window produces a real outward
    // velocity at release.
    dragWithTime(el, [
      { x: 50, y: 0, t: 50 },
      { x: 200, y: 0, t: 100 },
    ])

    const inertiaXCalls = animateSpy.mock.calls.filter((c) => {
      const value = c[0] as { _name?: string } | undefined
      const t = c[2] as { type?: string } | undefined
      return value?._name === "x" && t?.type === "inertia"
    })
    expect(inertiaXCalls.length).toBeGreaterThan(0)
    // The release momentum on x must have velocity 0 — the cursor pushed
    // outward, but with elastic=0 and the value already at the bound, the
    // heuristic suppresses the velocity to prevent the overshoot frame.
    const releaseTransition = inertiaXCalls.at(-1)?.[2] as { velocity: number }
    expect(releaseTransition.velocity).toBe(0)
    unmount()
  })

  it("preserves release-velocity when elastic=0 and value is INSIDE bounds (inward release)", () => {
    // Same setup but the release happens with the element well inside the
    // container with INWARD velocity — the at-bound heuristic should not
    // engage and the natural inertia glide must be preserved.
    const { container, unmount } = render(() => {
      const m = useMotion({
        drag: "x",
        dragConstraints: { left: -100, right: 100 },
        dragElastic: 0,
        dragMomentum: true,
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    // Move to x=90 and HOLD there for >200ms so earlier samples drop out
    // of the velocity sliding window, then sweep BACK to x=10. The
    // window now sees only the inward sweep — release velocity is
    // negative (inward).
    dragWithTime(el, [
      { x: 90, y: 0, t: 50 },
      { x: 90, y: 0, t: 300 }, // hold — flushes the 200ms window
      { x: 10, y: 0, t: 400 },
    ])

    const inertiaXCalls = animateSpy.mock.calls.filter((c) => {
      const value = c[0] as { _name?: string } | undefined
      const t = c[2] as { type?: string } | undefined
      return value?._name === "x" && t?.type === "inertia"
    })
    expect(inertiaXCalls.length).toBeGreaterThan(0)
    const releaseTransition = inertiaXCalls.at(-1)?.[2] as { velocity: number }
    // Velocity is computed from the sliding window: samples (5, 80, 10)
    // produce a negative net velocity. The heuristic must NOT zero it.
    expect(releaseTransition.velocity).not.toBe(0)
    expect(releaseTransition.velocity).toBeLessThan(0)
    unmount()
  })

  it("hard-clamps release-momentum at boundary when dragElastic is 0 (overdamp bounce)", () => {
    // Regression — release momentum's inertia bounce still oscillated past
    // the constraint and sprang back even with `dragElastic: 0` (hard
    // clamp), because the bounceStiffness/bounceDamping defaults give a
    // soft spring physics. motion-react's solution: when dragElastic is 0,
    // override the bounce params to very high values so the spring back is
    // effectively instant. We assert on the inertia transition's params.
    const { container, unmount } = render(() => {
      const m = useMotion({
        drag: true,
        dragConstraints: { left: -10, right: 20 },
        dragElastic: 0,
        dragMomentum: true,
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    drag(el, { x: 100, y: 100 })

    // The release path fires an animate(MV, 0, transition). Pick the
    // post-drag (inertia) animate calls and verify their bounce params
    // were overdamped for the hard-clamp setting.
    const inertiaCalls = animateSpy.mock.calls.filter((c) => {
      const t = c[2] as { type?: string } | undefined
      return t?.type === "inertia"
    })
    expect(inertiaCalls.length).toBeGreaterThan(0)
    for (const call of inertiaCalls) {
      const transition = call[2] as { bounceStiffness: number; bounceDamping: number }
      // Motion-react's overdamp values (1e6 / 1e7) are the lower bound for
      // an instant snap-back. We just check they're far above the default
      // (200/40) so the bounce is effectively immediate.
      expect(transition.bounceStiffness).toBeGreaterThanOrEqual(100_000)
      expect(transition.bounceDamping).toBeGreaterThanOrEqual(1_000_000)
    }
    unmount()
  })

  it("uses motion-react's default bounce params (200/40) when dragElastic > 0", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({
        drag: true,
        dragConstraints: { left: -10, right: 20 },
        dragElastic: 0.5,
        dragMomentum: true,
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    drag(el, { x: 100, y: 100 })

    const inertiaCalls = animateSpy.mock.calls.filter((c) => {
      const t = c[2] as { type?: string } | undefined
      return t?.type === "inertia"
    })
    expect(inertiaCalls.length).toBeGreaterThan(0)
    for (const call of inertiaCalls) {
      const transition = call[2] as { bounceStiffness: number; bounceDamping: number }
      // Bounce params should be the soft-spring values that allow the
      // visible rubber-band rebound, not the overdamped hard-clamp values.
      expect(transition.bounceStiffness).toBeLessThan(10_000)
      expect(transition.bounceDamping).toBeLessThan(10_000)
    }
    unmount()
  })

  it("springs back to bounds on release with momentum:false + elastic>0 (no momentum but bounce still applies)", () => {
    // Regression — with dragMomentum:false and dragElastic:0.5, the user
    // could drag the element past the bound (elastic overshoots) and
    // release. Our `else` branch skipped the animate call entirely,
    // leaving the element stranded outside the container.
    //
    // motion-react's fix: always run inertia on release; when
    // dragMomentum is false, just zero the velocity. The bounce physics
    // still pull the element back to the boundary on a soft spring.
    const { container, unmount } = render(() => {
      const m = useMotion({
        drag: true,
        dragConstraints: { left: -10, right: 20 },
        dragElastic: 0.5, // elastic > 0 — overshoot allowed during drag
        dragMomentum: false,
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    // Drag far past the right bound. With elastic 0.5, applyElastic lets
    // the value overshoot 20 (max) by half the overflow. On release we
    // need an animate call that brings x back inside the bound.
    drag(el, { x: 100, y: 0 }, { x: 200, y: 0 })

    // After the fix, we expect an inertia call on the x axis whose
    // min/max include the configured bounds — even though dragMomentum is
    // false. Pre-fix, no such call exists.
    const inertiaXCalls = animateSpy.mock.calls.filter((c) => {
      const value = c[0] as { _name?: string } | undefined
      const t = c[2] as { type?: string } | undefined
      return value?._name === "x" && t?.type === "inertia"
    })
    expect(inertiaXCalls.length).toBeGreaterThan(0)
    const release = inertiaXCalls.at(-1)?.[2] as {
      velocity: number
      min: number
      max: number
    }
    // momentum:false → velocity zeroed.
    expect(release.velocity).toBe(0)
    // Bounds still flow through — spring physics will pull overshot
    // values back to within (-10, 20).
    expect(release.min).toBe(-10)
    expect(release.max).toBe(20)
    unmount()
  })

  it("clamps both sides when the cursor crosses through a bounded axis (out-then-opposite-edge)", () => {
    // Regression — user reproduced this in the Drag demo with `drag: "x"`
    // and a container constraint: dragging far past one edge (cursor leaving
    // the container entirely), then sweeping the cursor toward the OPPOSITE
    // edge, "broke" the constraint. With elastic 0 the element should clamp
    // hard on BOTH excursions. This test pins the bidirectional clamping so
    // any future change that violates it fails loudly.
    const { container, unmount } = render(() => {
      const m = useMotion({
        drag: "x",
        dragConstraints: { left: -10, right: 20 },
        dragElastic: 0,
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    // Drag far past the right edge (offset 500), then sweep the pointer
    // past the left edge (offset -500). Each move recomputes candidateX
    // from start + offset, so both extremes should produce a clamped write.
    drag(el, { x: 500, y: 0 }, { x: -500, y: 0 })

    const xWrites = captured.writes.filter((w) => w.name === "x")
    // First excursion: clamp at right (20).
    expect(xWrites).toContainEqual({ name: "x", value: 20 })
    // Second excursion: clamp at left (-10). MUST appear.
    expect(xWrites).toContainEqual({ name: "x", value: -10 })
    // Last write is the leftward extreme — no values past min/max.
    expect(xWrites.at(-1)?.value).toBe(-10)
    for (const w of xWrites) {
      expect(w.value).toBeGreaterThanOrEqual(-10)
      expect(w.value).toBeLessThanOrEqual(20)
    }
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

  it("animate's x/y reach DOM when drag is idle (regression: drag-configured no longer steals x/y)", () => {
    // Drag CONFIGURED but not active → animate's x/y must flow normally.
    // This matches motion-react: drag and animate share the x/y MV and
    // only the source of writes alternates by pointer state. The previous
    // implementation filtered x/y from animate whenever drag was even
    // configured, which broke initial → animate transitions on draggable
    // elements (e.g. a slide-in drawer with drag-to-close).
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { x: 100, opacity: 1 }, drag: true })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    // animate's x=100 must appear in the spy's calls.
    const xCall = animateSpy.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.x === 100,
    )
    expect(xCall).toBeDefined()
    // opacity still flows.
    const opacityCall = animateSpy.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.opacity === 1,
    )
    expect(opacityCall).toBeDefined()
    unmount()
    // Suppress "el unused" lint — the test renders through it.
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

  it("fires onDragEnd AFTER motion's pan-end cleanup has finished", () => {
    // Regression: if onDragEnd fires mid-handlePanEnd, a synchronous state
    // flip inside the callback (e.g. closing a Dialog whose contents are
    // this draggable) can race motion's later momentum dispatch / MV-ref
    // cleanup and wedge surrounding libraries that observe the same DOM
    // (Kobalte's scroll lock + layer-stack pointer block was the symptom).
    //
    // The callback now fires at the very end of handlePanEnd — by which
    // point whileDrag is already false, body styles + pointer capture are
    // already restored, momentum is already dispatched, and xMV/yMV refs
    // are nulled. We assert those observable invariants from inside the
    // callback to lock the ordering.
    const observed: {
      whileDragActive: boolean | undefined
      bodyUserSelect: string
    } = {
      whileDragActive: undefined,
      bodyUserSelect: "",
    }
    const onDragEnd = vi.fn(() => {
      // bodyUserSelect should have been restored from "none" → ""
      // (or whatever the prior value was) before the callback fires.
      observed.bodyUserSelect = document.body.style.userSelect
      // whileDrag should be flipped off before the callback fires; we
      // observe this via the data-* attribute the gesture-state machine
      // would emit through the visible-state animate (the simplest proxy
      // for "active store updated and downstream effects ran" is checking
      // that motion's own MV refs have been nulled — captured below in
      // the post-call assertion).
      observed.whileDragActive = false
    })

    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true, onDragEnd })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    // Sanity: body.style.userSelect is "none" during drag (handlePanStart
    // sets it for the drag-in-progress visual). After pan-end it should
    // be restored before our callback observes it.
    drag(el, { x: 10, y: 0 })

    expect(onDragEnd).toHaveBeenCalledOnce()
    // The "none" the drag sets during the session should have been
    // cleared by the time the callback ran.
    expect(observed.bodyUserSelect).not.toBe("none")
    unmount()
  })

  it("fires onDragTransitionEnd after release with dragMomentum:false (via inertia.Promise.all)", async () => {
    // dragMomentum:false still runs the inertia animate path so the bounce
    // physics can pull the element back to bounds when elastic overshoots
    // during the drag. That means onDragTransitionEnd resolves through the
    // animate promise like the momentum:true case — async, not sync.
    const onDragTransitionEnd = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true, dragMomentum: false, onDragTransitionEnd })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    drag(el, { x: 10, y: 0 })

    await new Promise((r) => setTimeout(r, 0))
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

  it("dragMomentum=false still triggers inertia, but with velocity 0", () => {
    // dragMomentum:false means "don't carry pointer velocity into the
    // release glide" — NOT "skip the release animation entirely". The
    // inertia call still runs so its bounce physics can pull the element
    // back from any elastic overshoot during the drag. We assert both:
    //   (a) inertia IS called (one per axis), and
    //   (b) the velocity passed to it is 0 in both calls.
    const { container, unmount } = render(() => {
      const m = useMotion({ drag: true, dragMomentum: false })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    drag(el, { x: 10, y: 5 })

    const inertiaCalls = animateSpy.mock.calls.filter(
      (c) => (c[2] as Record<string, unknown> | undefined)?.type === "inertia",
    )
    expect(inertiaCalls.length).toBe(2)
    for (const call of inertiaCalls) {
      const t = call[2] as { velocity: number }
      expect(t.velocity).toBe(0)
    }
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
