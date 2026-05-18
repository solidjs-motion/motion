import { fireEvent, render } from "@solidjs/testing-library"
import { createComputed, createRoot, createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PanInfo } from "../../src/types"

// motion-dom's `time` is the timestamp source — mocking it lets tests
// control velocity calculations deterministically.
const { timeMock } = vi.hoisted(() => ({
  timeMock: { now: vi.fn(() => 0) },
}))

vi.mock("motion-dom", async () => {
  const actual = await vi.importActual<typeof import("motion-dom")>("motion-dom")
  return { ...actual, time: timeMock }
})

const { createPan } = await import("../../src/primitives/createPan")

beforeEach(() => {
  timeMock.now.mockReturnValue(0)
})

afterEach(() => {
  timeMock.now.mockReset()
  timeMock.now.mockReturnValue(0)
})

/** Helper: drive the time source forward. */
function setNow(ms: number) {
  timeMock.now.mockReturnValue(ms)
}

/** Snapshot a MotionValueAccessor pair (no tracking — uses `.get()`). */
function snapshotPair(pair: { x: { get: () => number }; y: { get: () => number } }): {
  x: number
  y: number
} {
  return { x: pair.x.get(), y: pair.y.get() }
}

// ---------------------------------------------------------------------------
// Threshold gating (Q11a — default 3px before onPanStart fires).
// ---------------------------------------------------------------------------

describe("createPan — threshold gating", () => {
  it("does NOT fire onPanStart if movement is below threshold", () => {
    const onPanStart = vi.fn()
    const { container, unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      createPan(el, { onPanStart })
      return <div ref={setEl} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 2, clientY: 0, isPrimary: true })
    expect(onPanStart).not.toHaveBeenCalled()
    unmount()
  })

  it("fires onPanStart once movement crosses the default 3px threshold", () => {
    const onPanStart = vi.fn()
    const { container, unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      createPan(el, { onPanStart })
      return <div ref={setEl} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })

    expect(onPanStart).toHaveBeenCalledOnce()
    const info = onPanStart.mock.calls[0]?.[1] as PanInfo
    expect(info.point).toEqual({ x: 5, y: 0 })
    expect(info.offset).toEqual({ x: 5, y: 0 })
    unmount()
  })

  it("respects a custom threshold value", () => {
    const onPanStart = vi.fn()
    const { container, unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      createPan(el, { onPanStart, threshold: 10 })
      return <div ref={setEl} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })
    expect(onPanStart).not.toHaveBeenCalled()

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 12, clientY: 0, isPrimary: true })
    expect(onPanStart).toHaveBeenCalledOnce()
    unmount()
  })

  it("reactive options form — threshold change applies to the NEXT session", () => {
    // Function-form options let users pass reactive values. The threshold
    // is read on each pointermove via getOpts(), so changes apply on the
    // next pre-threshold move. (Mid-session: only matters until the
    // threshold is crossed; after, the session continues regardless.)
    const onPanStart = vi.fn()
    const [threshold, setThreshold] = createSignal(3)
    const { container, unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      createPan(el, () => ({ onPanStart, threshold: threshold() }))
      return <div ref={setEl} />
    })
    const el = container.firstChild as HTMLElement

    // Session 1: threshold 3, 5px move crosses it.
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })
    expect(onPanStart).toHaveBeenCalledOnce()
    onPanStart.mockClear()

    // Reactive change: bump threshold to 20.
    setThreshold(20)

    // Session 2: threshold 20, 5px move should NOT cross.
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })
    expect(onPanStart).not.toHaveBeenCalled()

    // 22px crosses the new threshold.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 22, clientY: 0, isPrimary: true })
    expect(onPanStart).toHaveBeenCalledOnce()

    unmount()
  })

  it("reactive options form — callback change applies on next event", () => {
    // Callbacks are read via getOpts() each time they fire. Swapping the
    // callback at runtime takes effect immediately.
    const firstHandler = vi.fn()
    const secondHandler = vi.fn()
    const [handler, setHandler] = createSignal(firstHandler)
    const { container, unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      createPan(el, () => ({ onPan: handler() }))
      return <div ref={setEl} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    // First move crosses threshold (onPanStart fires, NOT onPan).
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })
    // Second move fires onPan with firstHandler.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 0, isPrimary: true })
    expect(firstHandler).toHaveBeenCalledOnce()
    expect(secondHandler).not.toHaveBeenCalled()

    // Swap handler.
    setHandler(() => secondHandler)

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 15, clientY: 0, isPrimary: true })
    expect(firstHandler).toHaveBeenCalledOnce() // still 1
    expect(secondHandler).toHaveBeenCalledOnce()

    unmount()
  })
})

// ---------------------------------------------------------------------------
// Lifecycle: onPanStart → onPan(s) → onPanEnd. PanInfo shape.
// ---------------------------------------------------------------------------

describe("createPan — lifecycle and PanInfo", () => {
  it("fires onPan on every move after onPanStart, with correct delta and offset", () => {
    const onPan = vi.fn()
    const { container, unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      createPan(el, { onPan })
      return <div ref={setEl} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })
    // First move starts pan; onPan NOT called for that one (only onPanStart).
    expect(onPan).not.toHaveBeenCalled()

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 5, isPrimary: true })
    expect(onPan).toHaveBeenCalledTimes(1)
    const info = onPan.mock.calls[0]?.[1] as PanInfo
    expect(info.point).toEqual({ x: 10, y: 5 })
    expect(info.delta).toEqual({ x: 5, y: 5 })
    expect(info.offset).toEqual({ x: 10, y: 5 })

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 8, clientY: 5, isPrimary: true })
    expect(onPan).toHaveBeenCalledTimes(2)
    const info2 = onPan.mock.calls[1]?.[1] as PanInfo
    expect(info2.delta).toEqual({ x: -2, y: 0 })
    expect(info2.offset).toEqual({ x: 8, y: 5 })
    unmount()
  })

  it("fires onPanEnd on pointerup AFTER pan has started", () => {
    const onPanEnd = vi.fn()
    const { container, unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      createPan(el, { onPanEnd })
      return <div ref={setEl} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 0, isPrimary: true })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 0, isPrimary: true })

    expect(onPanEnd).toHaveBeenCalledOnce()
    unmount()
  })

  it("does NOT fire onPanEnd when pointerup occurs without crossing threshold", () => {
    const onPanStart = vi.fn()
    const onPanEnd = vi.fn()
    const { container, unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      createPan(el, { onPanStart, onPanEnd })
      return <div ref={setEl} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 1, clientY: 0, isPrimary: true })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 1, clientY: 0, isPrimary: true })

    expect(onPanStart).not.toHaveBeenCalled()
    expect(onPanEnd).not.toHaveBeenCalled()
    unmount()
  })

  it("fires onPanEnd on pointercancel (gesture aborted by browser/system)", () => {
    const onPanEnd = vi.fn()
    const { container, unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      createPan(el, { onPanEnd })
      return <div ref={setEl} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 0, isPrimary: true })
    fireEvent.pointerCancel(window, { pointerId: 1, clientX: 10, clientY: 0, isPrimary: true })

    expect(onPanEnd).toHaveBeenCalledOnce()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Velocity computation (Q15a — 200ms sliding window).
// ---------------------------------------------------------------------------

describe("createPan — velocity tracking", () => {
  it("computes velocity from the 200ms sliding window of pointer samples", () => {
    const onPan = vi.fn()
    const { container, unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      createPan(el, { onPan })
      return <div ref={setEl} />
    })
    const el = container.firstChild as HTMLElement

    setNow(0)
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })

    setNow(50)
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 0, isPrimary: true })

    setNow(100)
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY: 0, isPrimary: true })

    expect(onPan).toHaveBeenCalledOnce()
    const info = onPan.mock.calls[0]?.[1] as PanInfo
    // Velocity = (latest − first) / dt × 1000.
    // Samples at this point: t=0,x=0 ; t=50,x=10 ; t=100,x=20.
    // (20 − 0) / 100 × 1000 = 200 px/sec.
    expect(info.velocity.x).toBeCloseTo(200)
    expect(info.velocity.y).toBe(0)
    unmount()
  })

  it("drops samples older than the 200ms window from the velocity calc", () => {
    const onPan = vi.fn()
    const { container, unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      createPan(el, { onPan })
      return <div ref={setEl} />
    })
    const el = container.firstChild as HTMLElement

    setNow(0)
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })

    setNow(50)
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 5, clientY: 0, isPrimary: true })

    setNow(400)
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 50, clientY: 0, isPrimary: true })

    const info = onPan.mock.calls[0]?.[1] as PanInfo
    expect(info.velocity.x).toBe(0)
    expect(info.velocity.y).toBe(0)
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Returned reactive surface — MotionValueAccessors for numeric pairs +
// Accessor<boolean> for isPanning (semantic split: MVs for animate-able
// values, Accessor for booleans).
// ---------------------------------------------------------------------------

describe("createPan — reactive return surface", () => {
  it("initializes all numeric MVs to zero and isPanning to false before any pointerdown", () => {
    const { unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      const pan = createPan(el)
      // Untracked snapshot reads via the MotionValue surface (.get).
      expect(pan.isPanning()).toBe(false)
      expect(snapshotPair(pan.point)).toEqual({ x: 0, y: 0 })
      expect(snapshotPair(pan.delta)).toEqual({ x: 0, y: 0 })
      expect(snapshotPair(pan.offset)).toEqual({ x: 0, y: 0 })
      expect(snapshotPair(pan.velocity)).toEqual({ x: 0, y: 0 })
      return <div ref={setEl} />
    })
    unmount()
  })

  it("updates MVs on every pointermove (Option X — pre-threshold included)", () => {
    let pan!: ReturnType<typeof createPan>
    const { container, unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      pan = createPan(el)
      return <div ref={setEl} />
    })
    const el = container.firstChild as HTMLElement

    // Pre-threshold move (1px < 3px default). isPanning still false, but
    // point/offset DO update under Option X.
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 50, isPrimary: true })
    expect(snapshotPair(pan.point)).toEqual({ x: 100, y: 50 })
    expect(pan.isPanning()).toBe(false)

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 101, clientY: 50, isPrimary: true })
    expect(snapshotPair(pan.point)).toEqual({ x: 101, y: 50 })
    expect(snapshotPair(pan.offset)).toEqual({ x: 1, y: 0 })
    expect(pan.isPanning()).toBe(false)

    // Threshold crossing flips isPanning true; fields keep updating.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 110, clientY: 50, isPrimary: true })
    expect(snapshotPair(pan.point)).toEqual({ x: 110, y: 50 })
    expect(snapshotPair(pan.offset)).toEqual({ x: 10, y: 0 })
    expect(pan.isPanning()).toBe(true)
    unmount()
  })

  it("retains last point/offset/velocity MV values after pointerup; only isPanning flips", () => {
    let pan!: ReturnType<typeof createPan>
    const { container, unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      pan = createPan(el)
      return <div ref={setEl} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 50, clientY: 30, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 80, clientY: 40, isPrimary: true })
    expect(pan.isPanning()).toBe(true)
    expect(snapshotPair(pan.point)).toEqual({ x: 80, y: 40 })

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 80, clientY: 40, isPrimary: true })

    expect(pan.isPanning()).toBe(false)
    // Point/offset MVs RETAINED (Option Q5/3 — "retain last").
    expect(snapshotPair(pan.point)).toEqual({ x: 80, y: 40 })
    expect(snapshotPair(pan.offset)).toEqual({ x: 80, y: 40 })
    unmount()
  })

  it("resets per-session MVs on a new pointerdown (offset/delta back to 0)", () => {
    let pan!: ReturnType<typeof createPan>
    const { container, unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      pan = createPan(el)
      return <div ref={setEl} />
    })
    const el = container.firstChild as HTMLElement

    // First session: end with offset {80, 40}.
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 80, clientY: 40, isPrimary: true })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 80, clientY: 40, isPrimary: true })
    expect(snapshotPair(pan.offset)).toEqual({ x: 80, y: 40 })

    // Second session starting at (200, 100). Offset MUST reset to zero,
    // not accumulate from the previous session's end value.
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 100, isPrimary: true })
    expect(snapshotPair(pan.point)).toEqual({ x: 200, y: 100 })
    expect(snapshotPair(pan.offset)).toEqual({ x: 0, y: 0 })
    expect(snapshotPair(pan.delta)).toEqual({ x: 0, y: 0 })
    expect(snapshotPair(pan.velocity)).toEqual({ x: 0, y: 0 })
    unmount()
  })

  it("per-MV granularity: reading only `point.x()` does not invalidate on velocity changes", () => {
    let pan!: ReturnType<typeof createPan>
    const xReadCount = vi.fn()
    const velocityReadCount = vi.fn()

    // Use render() — its internal scheduling flushes createEffect's first
    // iteration before fireEvent fires, so createPan's listener is attached.
    // Plain createRoot wouldn't flush, leaving the test racing the microtask.
    const { container, unmount } = render(() => {
      const [elRef, setElRef] = createSignal<HTMLElement>()
      pan = createPan(elRef)

      // createComputed (not createEffect) so re-runs from MV change events
      // happen synchronously — the test can read counts immediately after a
      // fireEvent without awaiting microtasks. Invoke the callable
      // hybrid (`pan.point.x()`) so the Solid bridge signal is tracked;
      // accessing `pan.point.x` alone returns the proxy object and would
      // NOT subscribe.
      createComputed(() => {
        void pan.point.x()
        xReadCount()
      })
      createComputed(() => {
        void pan.velocity.x()
        velocityReadCount()
      })

      return <div ref={setElRef} />
    })

    const el = container.firstChild as HTMLElement

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })

    const initialX = xReadCount.mock.calls.length
    const initialVel = velocityReadCount.mock.calls.length

    // Move that doesn't change velocity (jsdom: time stays 0 with our mock,
    // so velocity is 0 throughout). x DOES change.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 0, isPrimary: true })

    const finalX = xReadCount.mock.calls.length
    const finalVel = velocityReadCount.mock.calls.length

    // x effect re-ran (point.x changed).
    expect(finalX).toBeGreaterThan(initialX)
    // velocity effect did NOT re-run (velocity stayed 0 due to the
    // time-mock returning 0 for both samples). The MV change-event
    // bridge ensures consumers reading one MV aren't invalidated by
    // another MV's writes — the same per-field granularity Store
    // path-tracking gave, expressed via MotionValue subscriptions.
    expect(finalVel).toBe(initialVel)

    unmount()
  })

  it("point.x exposes the full MotionValue surface (.get / .set / .on / .getVelocity)", () => {
    // Lock down the callable-hybrid contract: numeric pairs are MotionValues,
    // not just signals. Consumers can pipe them into `animate()`,
    // `createTransform`, `useMotion` targets — the proxy forwards every
    // upstream MotionValue method through to the wrapped value.
    const { unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      const pan = createPan(el)
      const x = pan.point.x
      expect(typeof x).toBe("function") // callable as an Accessor
      expect(typeof x.get).toBe("function")
      expect(typeof x.set).toBe("function")
      expect(typeof x.on).toBe("function")
      expect(typeof x.getVelocity).toBe("function")
      return <div ref={setEl} />
    })
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Pointer validity (motion-dom's isPrimaryPointer filter).
// ---------------------------------------------------------------------------

describe("createPan — pointer validity", () => {
  it("ignores non-primary mouse buttons (right-click etc.)", () => {
    const onPanStart = vi.fn()
    const { container, unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      createPan(el, { onPanStart })
      return <div ref={setEl} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerDown(el, {
      pointerId: 1,
      button: 2,
      pointerType: "mouse",
      isPrimary: true,
    })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 0, isPrimary: true })

    expect(onPanStart).not.toHaveBeenCalled()
    unmount()
  })

  it("ignores pointermoves from a different pointerId (multi-touch)", () => {
    const onPan = vi.fn()
    const { container, unmount } = render(() => {
      const [el, setEl] = createSignal<HTMLElement>()
      createPan(el, { onPan })
      return <div ref={setEl} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 50, clientY: 50, isPrimary: false })

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY: 0, isPrimary: true })
    expect(onPan).toHaveBeenCalledOnce()
    const info = onPan.mock.calls[0]?.[1] as PanInfo
    expect(info.offset).toEqual({ x: 20, y: 0 })
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

describe("createPan — cleanup", () => {
  it("removes the pointerdown listener and any window listeners on owner disposal", () => {
    const onPanStart = vi.fn()
    let el!: HTMLElement
    const dispose = createRoot((d) => {
      el = document.createElement("div")
      createPan(() => el, { onPanStart })
      return d
    })
    dispose()

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 0, isPrimary: true })
    expect(onPanStart).not.toHaveBeenCalled()
  })

  it("cleans up mid-session window listeners on owner disposal", () => {
    const onPan = vi.fn()
    let el!: HTMLElement
    const dispose = createRoot((d) => {
      el = document.createElement("div")
      document.body.appendChild(el)
      createPan(() => el, { onPan })
      return d
    })

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 0, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 15, clientY: 0, isPrimary: true })
    expect(onPan).toHaveBeenCalledOnce()

    dispose()
    onPan.mockClear()

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 25, clientY: 0, isPrimary: true })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 25, clientY: 0, isPrimary: true })
    expect(onPan).not.toHaveBeenCalled()
    document.body.removeChild(el)
  })
})
