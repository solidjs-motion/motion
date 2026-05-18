import { render } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { animateSpy } = vi.hoisted(() => ({
  animateSpy: vi.fn((..._args: unknown[]) => ({
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
  })),
}))

vi.mock("motion", async () => {
  const actual = await vi.importActual<typeof import("motion")>("motion")
  return { ...actual, animate: animateSpy }
})

const { useMotion } = await import("../../src/use-motion")

// ---------------------------------------------------------------------------
// Controllable IntersectionObserver mock.
//
// tests/setup.ts has a default no-op mock that handles "the observer exists
// and observe() doesn't throw" — fine for Phase 1 tests that don't drive
// entries. For Phase 2 in-view gesture tests, we need to dispatch synthetic
// IntersectionObserverEntry events. This helper captures every constructor
// call so tests can grab the callback and fire it manually.
// ---------------------------------------------------------------------------

type CapturedObserver = {
  callback: IntersectionObserverCallback
  options: IntersectionObserverInit | undefined
  observe: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

let captured: CapturedObserver[] = []

function installControllableObserver() {
  // Structural duck-type rather than `implements IntersectionObserver` — TS's
  // lib.dom interface grew a `scrollMargin` property recently and bringing it
  // along adds runtime surface for no test gain. We cast at the assignment
  // site to satisfy the global type, the same pattern tests/setup.ts uses.
  class Controllable {
    callback: IntersectionObserverCallback
    root: Element | Document | null = null
    rootMargin = ""
    thresholds: ReadonlyArray<number> = []
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
    constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.callback = cb
      captured.push({
        callback: cb,
        options,
        observe: this.observe,
        disconnect: this.disconnect,
      })
    }
  }
  ;(
    globalThis as unknown as { IntersectionObserver: typeof IntersectionObserver }
  ).IntersectionObserver = Controllable as unknown as typeof IntersectionObserver
}

/** Synthesize an entry and dispatch it through the most-recent observer. */
function fireIntersection(el: Element, isIntersecting: boolean) {
  const last = captured.at(-1)
  if (!last) throw new Error("no IntersectionObserver constructed")
  const entry = {
    isIntersecting,
    target: el,
    intersectionRatio: isIntersecting ? 1 : 0,
    boundingClientRect: el.getBoundingClientRect(),
    intersectionRect: isIntersecting ? el.getBoundingClientRect() : new DOMRect(),
    rootBounds: null,
    time: performance.now(),
  } as unknown as IntersectionObserverEntry
  last.callback([entry], last as unknown as IntersectionObserver)
}

beforeEach(() => {
  animateSpy.mockClear()
  captured = []
  installControllableObserver()
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
// inView gesture state activation
// ---------------------------------------------------------------------------

describe("inView gesture — state activation", () => {
  it("activates whileInView on intersection, animates to inView target", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { opacity: 0 }, inView: { opacity: 1 } })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    animateSpy.mockClear()

    fireIntersection(el, true)

    expect(animateSpy).toHaveBeenCalled()
    expect(animateSpy.mock.calls.at(-1)?.[1]).toMatchObject({ opacity: 1 })
    unmount()
  })

  it("deactivates whileInView when intersection ends, falls back to animate", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { opacity: 0 }, inView: { opacity: 1 } })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    fireIntersection(el, true)
    animateSpy.mockClear()

    fireIntersection(el, false)

    expect(animateSpy).toHaveBeenCalled()
    expect(animateSpy.mock.calls.at(-1)?.[1]).toMatchObject({ opacity: 0 })
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Viewport options pass-through to IntersectionObserver constructor
// ---------------------------------------------------------------------------

describe("inView gesture — IntersectionObserver options", () => {
  it("passes margin and amount through to the observer", () => {
    render(() => {
      const m = useMotion({
        animate: { opacity: 0 },
        inView: { opacity: 1 },
        inViewOptions: { margin: "50px", amount: 0.7 },
      })
      return <div {...m()} />
    })

    const observer = captured.at(-1)
    expect(observer?.options?.rootMargin).toBe("50px")
    expect(observer?.options?.threshold).toBe(0.7)
  })

  it("maps amount: 'all' to threshold 1", () => {
    render(() => {
      const m = useMotion({
        animate: { opacity: 0 },
        inView: { opacity: 1 },
        inViewOptions: { amount: "all" },
      })
      return <div {...m()} />
    })

    const observer = captured.at(-1)
    expect(observer?.options?.threshold).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// `once: true` (Q10 — observer disconnects after first enter; whileInView
// stays active forever)
// ---------------------------------------------------------------------------

describe("inView gesture — once option", () => {
  it("keeps whileInView active after observer disconnects (once: true)", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({
        animate: { opacity: 0 },
        inView: { opacity: 1 },
        inViewOptions: { once: true },
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    animateSpy.mockClear()

    fireIntersection(el, true)
    const lastBefore = animateSpy.mock.calls.at(-1)?.[1]
    expect(lastBefore).toMatchObject({ opacity: 1 })

    // After the first intersection, createInView calls observer.disconnect().
    // The Accessor stays true; whileInView stays active in the state machine.
    // Even if the user could somehow fire a non-intersection entry (real DOM
    // wouldn't), our code path wouldn't deactivate.
    const observer = captured.at(-1)
    expect(observer?.disconnect).toHaveBeenCalled()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// onViewportEnter / onViewportLeave callbacks (Q10/A1 — extended createInView
// passes the raw entry through the onChange hook)
// ---------------------------------------------------------------------------

describe("inView gesture — callbacks", () => {
  it("fires onViewportEnter with the IntersectionObserverEntry on enter", () => {
    const onViewportEnter = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({
        animate: { opacity: 0 },
        inView: { opacity: 1 },
        onViewportEnter,
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    fireIntersection(el, true)

    expect(onViewportEnter).toHaveBeenCalledOnce()
    const entry = onViewportEnter.mock.calls[0]?.[0] as IntersectionObserverEntry
    expect(entry.isIntersecting).toBe(true)
    expect(entry.target).toBe(el)
    unmount()
  })

  it("fires onViewportLeave on intersection end", () => {
    const onViewportEnter = vi.fn()
    const onViewportLeave = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({
        animate: { opacity: 0 },
        inView: { opacity: 1 },
        onViewportEnter,
        onViewportLeave,
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    fireIntersection(el, true)

    fireIntersection(el, false)

    expect(onViewportLeave).toHaveBeenCalledOnce()
    const entry = onViewportLeave.mock.calls[0]?.[0] as IntersectionObserverEntry
    expect(entry.isIntersecting).toBe(false)
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

describe("inView gesture — cleanup", () => {
  it("disconnects the observer on unmount", () => {
    const { unmount } = render(() => {
      const m = useMotion({ animate: { opacity: 0 }, inView: { opacity: 1 } })
      return <div {...m()} />
    })
    const observer = captured.at(-1)
    expect(observer?.disconnect).not.toHaveBeenCalled()

    unmount()

    expect(observer?.disconnect).toHaveBeenCalled()
  })
})
