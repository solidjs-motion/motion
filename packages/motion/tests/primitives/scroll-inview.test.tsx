import { render } from "@solidjs/testing-library"
import { createRoot, createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Spy on motion's `scroll` before importing the createScroll primitive.
const scrollHandlers: Array<{
  handler: (progress: number, info: unknown) => void
  cleanup: () => void
}> = []

// Variadic args so mock.calls[i]?.[1] (options) is accessible for assertions.
const scrollSpy = vi.fn((...args: unknown[]) => {
  const handler = args[0] as (progress: number, info: unknown) => void
  const cleanup = vi.fn()
  scrollHandlers.push({ handler, cleanup })
  return cleanup
})

vi.mock("motion", async () => {
  const actual = await vi.importActual<typeof import("motion")>("motion")
  return { ...actual, scroll: scrollSpy }
})

const { createScroll } = await import("../../src/primitives/createScroll")
const { createInView } = await import("../../src/primitives/createInView")

beforeEach(() => {
  scrollSpy.mockClear()
  scrollHandlers.length = 0
})

// Solid's `createEffect` schedules its first iteration in the next microtask
// (and again on each tracked signal change). Tests that drive state and
// then assert synchronously need a microtask flush in between. Two `await`s
// are safe: one for the effect queue, one for any cascading writes (the
// createInView observer triggers can chain a setState into a second
// effect-iteration).
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

// ---------------------------------------------------------------------------
// createScroll
// ---------------------------------------------------------------------------

describe("createScroll", () => {
  it("returns four MotionValues seeded to 0", () => {
    createRoot((dispose) => {
      const r = createScroll()
      // .get() reads the MV directly — no effect-tracking involved, so no
      // microtask wait required for this assertion.
      expect(r.scrollX.get()).toBe(0)
      expect(r.scrollY.get()).toBe(0)
      expect(r.scrollXProgress.get()).toBe(0)
      expect(r.scrollYProgress.get()).toBe(0)
      dispose()
    })
  })

  it("invokes motion's scroll() with the configured options", async () => {
    const container = document.createElement("div")
    const { dispose } = createRoot((dispose) => {
      createScroll({ container, axis: "y" })
      return { dispose }
    })
    // createEffect's first iteration is deferred — flush before asserting
    // that motion.scroll was invoked.
    await flush()
    expect(scrollSpy).toHaveBeenCalled()
    const opts = scrollSpy.mock.calls[0]?.[1]
    expect((opts as Record<string, unknown>).container).toBe(container)
    expect((opts as Record<string, unknown>).axis).toBe("y")
    dispose()
  })

  it("updates motion values when motion's scroll callback fires with info", async () => {
    const { r, dispose } = createRoot((dispose) => ({ r: createScroll(), dispose }))
    await flush()
    const entry = scrollHandlers[0]
    expect(entry).toBeDefined()
    entry?.handler(0.5, {
      x: { current: 100, progress: 0.5 },
      y: { current: 200, progress: 0.25 },
    })
    expect(r.scrollX.get()).toBe(100)
    expect(r.scrollY.get()).toBe(200)
    expect(r.scrollXProgress.get()).toBe(0.5)
    expect(r.scrollYProgress.get()).toBe(0.25)
    dispose()
  })

  it("calls motion's cleanup function on owner disposal", async () => {
    const { dispose } = createRoot((dispose) => {
      createScroll()
      return { dispose }
    })
    await flush()
    const entry = scrollHandlers[0]
    expect(entry).toBeDefined()
    expect(entry?.cleanup).not.toHaveBeenCalled()
    dispose()
    expect(entry?.cleanup).toHaveBeenCalled()
  })

  it("re-invokes motion's scroll() when the options accessor changes", async () => {
    // Accessor-form options reactivity. Per-field accessors on container/
    // target were dropped in 0.2.0; reactivity comes from wrapping the
    // whole options object in an accessor.
    const [container, setContainer] = createSignal<HTMLElement | null>(null)
    const { dispose } = createRoot((dispose) => {
      createScroll(() => ({ container: container() }))
      return { dispose }
    })
    await flush()
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    const first = scrollHandlers[0]
    // Swap to a real element — accessor returns new options, the effect
    // re-runs (after a microtask), previous subscription is torn down.
    setContainer(document.createElement("div"))
    await flush()
    expect(scrollSpy).toHaveBeenCalledTimes(2)
    expect(first?.cleanup).toHaveBeenCalled()
    dispose()
  })

  // Regression: motion-utils' `progress(0, 0, 0)` returns 1 when there's no
  // scrollable content (scrollHeight === clientHeight). On a Presence
  // wait-mode route transition, the new route's createScroll subscribes
  // while the new content is still in an off-DOM holding pen — at subscribe
  // time the live DOM is the outgoing route, which may be non-scrollable.
  // motion-dom then dispatches `progress === 1` immediately, painting a
  // fully-filled progress bar until the user scrolls. createScroll must
  // suppress this edge-case dispatch until a real measurement arrives.
  it("suppresses the 'no scrollable content' edge-case dispatch", async () => {
    const { r, dispose } = createRoot((dispose) => ({ r: createScroll(), dispose }))
    await flush()
    const entry = scrollHandlers[0]
    expect(entry).toBeDefined()

    // Edge-case dispatch: motion-dom's progress() fell through its
    // toFromDifference === 0 branch, returning 1 with zero current and
    // zero scrollLength on both axes.
    entry?.handler(1, {
      x: { current: 0, progress: 1, scrollLength: 0 },
      y: { current: 0, progress: 1, scrollLength: 0 },
    })
    expect(r.scrollY.get()).toBe(0)
    expect(r.scrollYProgress.get()).toBe(0)
    expect(r.scrollX.get()).toBe(0)
    expect(r.scrollXProgress.get()).toBe(0)

    // Real measurement lands (e.g. the new route swapped into the live DOM
    // and trackContentSize's per-frame dimension check refired). Gate
    // flips; MVs update.
    entry?.handler(0, {
      x: { current: 0, progress: 0, scrollLength: 0 },
      y: { current: 0, progress: 0, scrollLength: 4000 },
    })
    expect(r.scrollYProgress.get()).toBe(0)

    // Subsequent edge-case dispatches no longer suppress — once we've
    // observed real layout, we trust the engine.
    entry?.handler(1, {
      x: { current: 0, progress: 1, scrollLength: 0 },
      y: { current: 0, progress: 1, scrollLength: 0 },
    })
    expect(r.scrollYProgress.get()).toBe(1)

    dispose()
  })

  it("opens the gate when only `current` is non-zero", async () => {
    const { r, dispose } = createRoot((dispose) => ({ r: createScroll(), dispose }))
    await flush()
    const entry = scrollHandlers[0]
    expect(entry).toBeDefined()

    // scrollLength can momentarily be 0 mid-transition while scrollTop is
    // already non-zero (e.g. user scrolled, then content collapsed). The
    // gate must consider `current` too, otherwise legitimate scrolls get
    // silently dropped.
    entry?.handler(0, {
      x: { current: 0, progress: 0, scrollLength: 0 },
      y: { current: 50, progress: 0, scrollLength: 0 },
    })
    expect(r.scrollY.get()).toBe(50)

    dispose()
  })

  it("defaults trackContentSize to true", async () => {
    const { dispose } = createRoot((dispose) => {
      createScroll()
      return { dispose }
    })
    await flush()
    const opts = scrollSpy.mock.calls[0]?.[1]
    expect((opts as Record<string, unknown>).trackContentSize).toBe(true)
    dispose()
  })

  it("honors an explicit trackContentSize: false override", async () => {
    const { dispose } = createRoot((dispose) => {
      createScroll({ trackContentSize: false })
      return { dispose }
    })
    await flush()
    const opts = scrollSpy.mock.calls[0]?.[1]
    expect((opts as Record<string, unknown>).trackContentSize).toBe(false)
    dispose()
  })
})

// ---------------------------------------------------------------------------
// createInView
// ---------------------------------------------------------------------------

type ObserverInstance = {
  callback: IntersectionObserverCallback
  options: IntersectionObserverInit | undefined
  observed: Element[]
  disconnect: () => void
  trigger: (entries: Array<Partial<IntersectionObserverEntry>>) => void
}

let observers: ObserverInstance[] = []

beforeEach(() => {
  observers = []
  class TestIntersectionObserver implements IntersectionObserver {
    callback: IntersectionObserverCallback
    options: IntersectionObserverInit | undefined
    observed: Element[] = []
    root: Element | Document | null = null
    rootMargin = "0px"
    scrollMargin = "0px"
    thresholds: ReadonlyArray<number> = [0]

    constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
      this.callback = cb
      this.options = opts
      const instance: ObserverInstance = {
        callback: cb,
        options: opts,
        observed: this.observed,
        disconnect: () => {
          this.observed.length = 0
        },
        trigger: (entries) => {
          this.callback(entries as IntersectionObserverEntry[], this as IntersectionObserver)
        },
      }
      observers.push(instance)
    }

    observe(el: Element) {
      this.observed.push(el)
    }
    unobserve() {}
    disconnect() {
      this.observed.length = 0
    }
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }
  ;(
    globalThis as unknown as { IntersectionObserver: typeof IntersectionObserver }
  ).IntersectionObserver = TestIntersectionObserver as unknown as typeof IntersectionObserver
})

afterEach(() => {
  observers = []
})

describe("createInView", () => {
  it("returns { isInView, entry } Accessors defaulting to false / null", () => {
    createRoot((dispose) => {
      const [el] = createSignal<Element | null>(null)
      const view = createInView(el)
      // Both fields are plain Solid Accessors — booleans and objects aren't
      // animate-able, so we don't wrap them in a MotionValueAccessor
      // (semantic split: MVs only where composability with `animate()`,
      // `createTransform`, `useMotion` targets actually buys something).
      expect(typeof view.isInView).toBe("function")
      expect(typeof view.entry).toBe("function")
      expect(view.isInView()).toBe(false)
      expect(view.entry()).toBeNull()
      dispose()
    })
  })

  it("attaches an IntersectionObserver once the ref returns an element", async () => {
    const div = document.createElement("div")
    const [el, setEl] = createSignal<Element | null>(null)
    const { dispose } = createRoot((dispose) => {
      createInView(el)
      return { dispose }
    })
    // Pre-flush: effect's first iteration hasn't run, ref returns null,
    // observer isn't attached.
    expect(observers.length).toBe(0)
    setEl(div)
    // createEffect re-runs in the next microtask after the signal change.
    await flush()
    expect(observers.length).toBe(1)
    expect(observers[0]?.observed).toContain(div)
    dispose()
  })

  it("accepts a static Element as the ref argument (captured once)", async () => {
    // Q1 ref widening — createInView now accepts a static Element in
    // addition to an Accessor. The element is captured once; reassignment
    // of the variable doesn't re-attach the observer (use the accessor
    // form for reactive refs).
    const div = document.createElement("div")
    const { dispose } = createRoot((dispose) => {
      createInView(div)
      return { dispose }
    })
    await flush()
    expect(observers.length).toBe(1)
    expect(observers[0]?.observed).toContain(div)
    dispose()
  })

  it("re-attaches the observer when a signal in the options accessor changes", async () => {
    // Accessor-form options reactivity — the canonical escape hatch for
    // changing IntersectionObserver config (root, margin, amount) at
    // runtime. When a signal read inside the options accessor changes,
    // the createEffect re-runs, disconnects the old observer, and
    // attaches a new one with the updated options.
    const div = document.createElement("div")
    const rootA = document.createElement("div")
    const rootB = document.createElement("div")
    const [rootEl, setRootEl] = createSignal<Element>(rootA)

    const { dispose } = createRoot((dispose) => {
      createInView(div, () => ({ root: rootEl(), margin: "10px" }))
      return { dispose }
    })
    await flush()

    expect(observers.length).toBe(1)
    expect(observers[0]?.options?.root).toBe(rootA)
    expect(observers[0]?.observed).toContain(div)

    // Flip the signal — effect re-runs, new observer created, old one
    // disconnected (its `observed` array is cleared by the spy).
    setRootEl(rootB)
    await flush()

    expect(observers.length).toBe(2)
    expect(observers[1]?.options?.root).toBe(rootB)
    expect(observers[1]?.observed).toContain(div)
    expect(observers[0]?.observed.length).toBe(0)

    dispose()
  })

  it("flips isInView to true on intersecting entry", async () => {
    const div = document.createElement("div")
    const { view, dispose } = createRoot((dispose) => {
      const [el, setEl] = createSignal<Element | null>(null)
      const v = createInView(el)
      setEl(div)
      return { view: v, dispose }
    })
    await flush()
    expect(view.isInView()).toBe(false)
    observers[0]?.trigger([{ isIntersecting: true } as IntersectionObserverEntry])
    expect(view.isInView()).toBe(true)
    dispose()
  })

  it("flips back to false when leaving viewport (default options)", async () => {
    const div = document.createElement("div")
    const { view, dispose } = createRoot((dispose) => {
      const [el, setEl] = createSignal<Element | null>(null)
      const v = createInView(el)
      setEl(div)
      return { view: v, dispose }
    })
    await flush()
    observers[0]?.trigger([{ isIntersecting: true } as IntersectionObserverEntry])
    expect(view.isInView()).toBe(true)
    observers[0]?.trigger([{ isIntersecting: false } as IntersectionObserverEntry])
    expect(view.isInView()).toBe(false)
    dispose()
  })

  it("with once:true, disconnects after first intersection and stops toggling", async () => {
    const div = document.createElement("div")
    const { view, dispose } = createRoot((dispose) => {
      const [el, setEl] = createSignal<Element | null>(null)
      const v = createInView(el, { once: true })
      setEl(div)
      return { view: v, dispose }
    })
    await flush()
    observers[0]?.trigger([{ isIntersecting: true } as IntersectionObserverEntry])
    expect(view.isInView()).toBe(true)
    expect(observers[0]?.observed).toEqual([])
    observers[0]?.trigger([{ isIntersecting: false } as IntersectionObserverEntry])
    expect(view.isInView()).toBe(true)
    dispose()
  })

  it("exposes the raw IntersectionObserverEntry via view.entry()", async () => {
    const div = document.createElement("div")
    const { view, dispose } = createRoot((dispose) => {
      const [el, setEl] = createSignal<Element | null>(null)
      const v = createInView(el)
      setEl(div)
      return { view: v, dispose }
    })
    await flush()
    expect(view.entry()).toBeNull()
    const fakeEntry = { isIntersecting: true, intersectionRatio: 0.5 } as IntersectionObserverEntry
    observers[0]?.trigger([fakeEntry])
    expect(view.entry()).toBe(fakeEntry)
    // The entry signal updates on every transition — including the leave.
    const leaveEntry = { isIntersecting: false, intersectionRatio: 0 } as IntersectionObserverEntry
    observers[0]?.trigger([leaveEntry])
    expect(view.entry()).toBe(leaveEntry)
    dispose()
  })

  it("fires onChange on every visibility transition with the raw entry", async () => {
    const div = document.createElement("div")
    const onChange = vi.fn()
    const { dispose } = createRoot((dispose) => {
      const [el, setEl] = createSignal<Element | null>(null)
      createInView(el, { onChange })
      setEl(div)
      return { dispose }
    })
    await flush()
    const enter = { isIntersecting: true } as IntersectionObserverEntry
    const leave = { isIntersecting: false } as IntersectionObserverEntry
    observers[0]?.trigger([enter])
    observers[0]?.trigger([leave])
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange.mock.calls[0]?.[0]).toBe(enter)
    expect(onChange.mock.calls[1]?.[0]).toBe(leave)
    dispose()
  })

  it("passes margin, root, and amount through to IntersectionObserver options", async () => {
    const div = document.createElement("div")
    const rootEl = document.createElement("div")
    const { dispose } = createRoot((dispose) => {
      const [el, setEl] = createSignal<Element | null>(null)
      createInView(el, () => ({ margin: "100px", amount: 0.5, root: rootEl }))
      setEl(div)
      return { dispose }
    })
    await flush()
    expect(observers[0]?.options?.rootMargin).toBe("100px")
    expect(observers[0]?.options?.threshold).toBe(0.5)
    expect(observers[0]?.options?.root).toBe(rootEl)
    dispose()
  })

  it("maps amount='all' to threshold 1", async () => {
    const div = document.createElement("div")
    const { dispose } = createRoot((dispose) => {
      const [el, setEl] = createSignal<Element | null>(null)
      createInView(el, { amount: "all" })
      setEl(div)
      return { dispose }
    })
    await flush()
    expect(observers[0]?.options?.threshold).toBe(1)
    dispose()
  })

  it("maps amount='some' (default) to threshold 0", async () => {
    const div = document.createElement("div")
    const { dispose } = createRoot((dispose) => {
      const [el, setEl] = createSignal<Element | null>(null)
      createInView(el, { amount: "some" })
      setEl(div)
      return { dispose }
    })
    await flush()
    expect(observers[0]?.options?.threshold).toBe(0)
    dispose()
  })

  it("passes a number[] amount through to IntersectionObserver verbatim", async () => {
    // With a single threshold the observer fires once per direction crossing
    // and the reported intersectionRatio is whatever the actual ratio
    // happens to be at that moment — but no further updates fire. For
    // continuous ratio tracking (a scroll-linked fade, a progress readout),
    // the user passes an array of thresholds; the observer then fires at
    // each crossing. This test pins the array-pass-through behavior.
    const div = document.createElement("div")
    const thresholds = [0, 0.25, 0.5, 0.75, 1]
    const { dispose } = createRoot((dispose) => {
      const [el, setEl] = createSignal<Element | null>(null)
      createInView(el, { amount: thresholds })
      setEl(div)
      return { dispose }
    })
    await flush()
    expect(observers[0]?.options?.threshold).toEqual(thresholds)
    dispose()
  })
})

describe("createInView in real-component usage", () => {
  it("attaches observer to a rendered element via ref", () => {
    const [el, setEl] = createSignal<HTMLDivElement | undefined>()
    let view: ReturnType<typeof createInView> | undefined
    render(() => {
      view = createInView(() => el() ?? null, { once: true })
      return <div ref={setEl}>watch me</div>
    })
    // render() from @solidjs/testing-library flushes the effect queue before
    // returning — no explicit microtask wait needed in this path.
    expect(observers.length).toBe(1)
    observers[0]?.trigger([{ isIntersecting: true } as IntersectionObserverEntry])
    expect(view?.isInView()).toBe(true)
  })
})
