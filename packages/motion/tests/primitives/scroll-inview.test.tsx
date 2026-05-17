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

// ---------------------------------------------------------------------------
// createScroll
// ---------------------------------------------------------------------------

describe("createScroll", () => {
  it("returns four MotionValues seeded to 0", () => {
    createRoot((dispose) => {
      const r = createScroll()
      expect(r.scrollX.get()).toBe(0)
      expect(r.scrollY.get()).toBe(0)
      expect(r.scrollXProgress.get()).toBe(0)
      expect(r.scrollYProgress.get()).toBe(0)
      dispose()
    })
  })

  it("invokes motion's scroll() with the configured options (synchronous via createComputed)", () => {
    const container = document.createElement("div")
    createRoot((dispose) => {
      createScroll({ container: () => container, axis: "y" })
      expect(scrollSpy).toHaveBeenCalled()
      const opts = scrollSpy.mock.calls[0]?.[1]
      expect((opts as Record<string, unknown>).container).toBe(container)
      expect((opts as Record<string, unknown>).axis).toBe("y")
      dispose()
    })
  })

  it("updates motion values when motion's scroll callback fires with info", () => {
    createRoot((dispose) => {
      const r = createScroll()
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
  })

  it("calls motion's cleanup function on owner disposal", () => {
    const { dispose } = createRoot((dispose) => {
      createScroll()
      return { dispose }
    })
    const entry = scrollHandlers[0]
    expect(entry).toBeDefined()
    expect(entry?.cleanup).not.toHaveBeenCalled()
    dispose()
    expect(entry?.cleanup).toHaveBeenCalled()
  })

  it("re-invokes motion's scroll() when the container accessor changes", () => {
    const [container, setContainer] = createSignal<HTMLElement | null>(null)
    createRoot((dispose) => {
      createScroll({ container: () => container() })
      expect(scrollSpy).toHaveBeenCalledTimes(1)
      const first = scrollHandlers[0]
      // Swap to a real element — accessor changes, createComputed re-runs
      // synchronously, previous subscription is torn down.
      setContainer(document.createElement("div"))
      expect(scrollSpy).toHaveBeenCalledTimes(2)
      expect(first?.cleanup).toHaveBeenCalled()
      dispose()
    })
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
  it("returns an Accessor<boolean>, defaulting to false", () => {
    createRoot((dispose) => {
      const [el] = createSignal<Element | null>(null)
      const visible = createInView(el)
      expect(typeof visible).toBe("function")
      expect(visible()).toBe(false)
      dispose()
    })
  })

  it("attaches an IntersectionObserver synchronously once the ref returns an element", () => {
    const div = document.createElement("div")
    const [el, setEl] = createSignal<Element | null>(null)
    createRoot((dispose) => {
      createInView(el)
      expect(observers.length).toBe(0)
      // setEl triggers the createComputed re-run synchronously; no microtask wait needed.
      setEl(div)
      expect(observers.length).toBe(1)
      expect(observers[0]?.observed).toContain(div)
      dispose()
    })
  })

  it("flips to true on intersecting entry", () => {
    const div = document.createElement("div")
    createRoot((dispose) => {
      const [el, setEl] = createSignal<Element | null>(null)
      const visible = createInView(el)
      setEl(div)
      expect(visible()).toBe(false)
      observers[0]?.trigger([{ isIntersecting: true } as IntersectionObserverEntry])
      expect(visible()).toBe(true)
      dispose()
    })
  })

  it("flips back to false when leaving viewport (default options)", () => {
    const div = document.createElement("div")
    createRoot((dispose) => {
      const [el, setEl] = createSignal<Element | null>(null)
      const visible = createInView(el)
      setEl(div)
      observers[0]?.trigger([{ isIntersecting: true } as IntersectionObserverEntry])
      expect(visible()).toBe(true)
      observers[0]?.trigger([{ isIntersecting: false } as IntersectionObserverEntry])
      expect(visible()).toBe(false)
      dispose()
    })
  })

  it("with once:true, disconnects after first intersection and stops toggling", () => {
    const div = document.createElement("div")
    createRoot((dispose) => {
      const [el, setEl] = createSignal<Element | null>(null)
      const visible = createInView(el, { once: true })
      setEl(div)
      observers[0]?.trigger([{ isIntersecting: true } as IntersectionObserverEntry])
      expect(visible()).toBe(true)
      expect(observers[0]?.observed).toEqual([])
      observers[0]?.trigger([{ isIntersecting: false } as IntersectionObserverEntry])
      expect(visible()).toBe(true)
      dispose()
    })
  })

  it("passes margin, root, and amount through to IntersectionObserver options", () => {
    const div = document.createElement("div")
    const rootEl = document.createElement("div")
    createRoot((dispose) => {
      const [el, setEl] = createSignal<Element | null>(null)
      createInView(el, { margin: "100px", amount: 0.5, root: () => rootEl })
      setEl(div)
      expect(observers[0]?.options?.rootMargin).toBe("100px")
      expect(observers[0]?.options?.threshold).toBe(0.5)
      expect(observers[0]?.options?.root).toBe(rootEl)
      dispose()
    })
  })

  it("maps amount='all' to threshold 1", () => {
    const div = document.createElement("div")
    createRoot((dispose) => {
      const [el, setEl] = createSignal<Element | null>(null)
      createInView(el, { amount: "all" })
      setEl(div)
      expect(observers[0]?.options?.threshold).toBe(1)
      dispose()
    })
  })

  it("maps amount='some' (default) to threshold 0", () => {
    const div = document.createElement("div")
    createRoot((dispose) => {
      const [el, setEl] = createSignal<Element | null>(null)
      createInView(el, { amount: "some" })
      setEl(div)
      expect(observers[0]?.options?.threshold).toBe(0)
      dispose()
    })
  })
})

describe("createInView in real-component usage", () => {
  it("attaches observer to a rendered element via ref", () => {
    const [el, setEl] = createSignal<HTMLDivElement | undefined>()
    let visible: import("solid-js").Accessor<boolean> | undefined
    render(() => {
      visible = createInView(() => el() ?? null, { once: true })
      return <div ref={setEl}>watch me</div>
    })
    // The ref callback runs synchronously on mount, setEl fires, createComputed
    // re-runs, observer attaches — all before render() returns.
    expect(observers.length).toBe(1)
    observers[0]?.trigger([{ isIntersecting: true } as IntersectionObserverEntry])
    expect(visible?.()).toBe(true)
  })
})
