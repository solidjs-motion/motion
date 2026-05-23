import { render } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useMotion } from "../../src/use-motion"

// ---------------------------------------------------------------------------
// Stub `motion`'s `animate` (same pattern as basic-flip.test.tsx) so we
// observe the trigger → measurement → animate-call contract without coupling
// to spring timing.
// ---------------------------------------------------------------------------

const animateSpy = vi.fn()

vi.mock("motion", async () => {
  const actual = await vi.importActual<typeof import("motion")>("motion")
  return {
    ...actual,
    animate: (...args: unknown[]) => {
      animateSpy(...args)
      return Object.assign(Promise.resolve(), { stop: () => {}, pause: () => {}, play: () => {} })
    },
  }
})

// ---------------------------------------------------------------------------
// ResizeObserver mock — captures each instance's callback + observed
// elements so tests can fire callbacks manually. jsdom has no real RO.
// ---------------------------------------------------------------------------

type RoInstance = { cb: ResizeObserverCallback; elements: Set<Element> }
let roInstances: RoInstance[] = []

class TestResizeObserver {
  cb: ResizeObserverCallback
  elements = new Set<Element>()
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
    roInstances.push(this as unknown as RoInstance)
  }
  observe(el: Element): void {
    this.elements.add(el)
  }
  unobserve(el: Element): void {
    this.elements.delete(el)
  }
  disconnect(): void {
    this.elements.clear()
    roInstances = roInstances.filter((i) => i !== (this as unknown as RoInstance))
  }
}

function fireResize(el: Element): void {
  for (const instance of roInstances) {
    if (instance.elements.has(el)) {
      const entry = { target: el } as unknown as ResizeObserverEntry
      instance.cb([entry], instance as unknown as ResizeObserver)
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
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
  roInstances = []
  vi.stubGlobal("ResizeObserver", TestResizeObserver)
})

afterEach(() => {
  document.documentElement.getBoundingClientRect = originalDocElementRect
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------

describe("layout: trigger sources", () => {
  describe("ResizeObserver(self)", () => {
    it("fires a measurement when the element resizes", async () => {
      function Component() {
        const m = useMotion(() => ({ layout: true }))
        return <div data-testid="el" {...m()} />
      }
      const { container } = render(() => <Component />)
      const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
      stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
      await flushFrame()
      // Resize the element.
      stubRect(el, { x: 0, y: 0, width: 200, height: 50 })
      fireResize(el)
      await flushFrame()
      expect(el.style.transform).toContain("scaleX(0.5)")
      expect(el.style.transform).toContain("scaleY(2)")
    })

    it("disconnects the observer on owner cleanup", async () => {
      function Component() {
        const m = useMotion(() => ({ layout: true }))
        return <div data-testid="el" {...m()} />
      }
      const { container, unmount } = render(() => <Component />)
      const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
      stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
      await flushFrame()
      // One RO instance observing one element.
      const instance = roInstances.find((i) => i.elements.has(el))
      expect(instance?.elements.has(el)).toBe(true)
      unmount()
      // After unmount, the RO is disconnected — element no longer
      // present in any instance's observed-set.
      const stillObserved = roInstances.some((i) => i.elements.has(el))
      expect(stillObserved).toBe(false)
    })
  })

  describe("MutationObserver(parent)", () => {
    it("fires a measurement when a sibling is inserted (childList)", async () => {
      function Component() {
        const m = useMotion(() => ({ layout: true }))
        return (
          <div data-testid="container">
            <div data-testid="el" {...m()} />
          </div>
        )
      }
      const { container } = render(() => <Component />)
      const wrapper = container.querySelector<HTMLElement>(
        "[data-testid='container']",
      ) as HTMLElement
      const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
      stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
      await flushFrame()
      // Shift the element AND insert a sibling. MO fires on childList
      // mutation; controller re-measures and sees the shifted rect.
      stubRect(el, { x: 0, y: 50, width: 100, height: 100 })
      wrapper.appendChild(document.createElement("span"))
      await flushFrame()
      expect(el.style.transform).toContain("translateY(-50px)")
    })

    it("fires a measurement when parent.style mutates (e.g., alignItems change)", async () => {
      function Component() {
        const m = useMotion(() => ({ layout: true }))
        return (
          <div data-testid="container">
            <div data-testid="el" {...m()} />
          </div>
        )
      }
      const { container } = render(() => <Component />)
      const wrapper = container.querySelector<HTMLElement>(
        "[data-testid='container']",
      ) as HTMLElement
      const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
      stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
      await flushFrame()
      // Simulate parent alignItems change: element moves; parent style
      // attribute mutates; MO fires; controller re-measures.
      stubRect(el, { x: 50, y: 0, width: 100, height: 100 })
      wrapper.setAttribute("style", "align-items: flex-end")
      await flushFrame()
      expect(el.style.transform).toContain("translateX(-50px)")
    })

    it("fires a measurement when parent.class mutates", async () => {
      function Component() {
        const m = useMotion(() => ({ layout: true }))
        return (
          <div data-testid="container">
            <div data-testid="el" {...m()} />
          </div>
        )
      }
      const { container } = render(() => <Component />)
      const wrapper = container.querySelector<HTMLElement>(
        "[data-testid='container']",
      ) as HTMLElement
      const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
      stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
      await flushFrame()
      stubRect(el, { x: 25, y: 0, width: 100, height: 100 })
      wrapper.className = "active"
      await flushFrame()
      expect(el.style.transform).toContain("translateX(-25px)")
    })

    it("does NOT fire on attributes outside the watch list (e.g., data-*)", async () => {
      function Component() {
        const m = useMotion(() => ({ layout: true }))
        return (
          <div data-testid="container">
            <div data-testid="el" {...m()} />
          </div>
        )
      }
      const { container } = render(() => <Component />)
      const wrapper = container.querySelector<HTMLElement>(
        "[data-testid='container']",
      ) as HTMLElement
      const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
      stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
      await flushFrame()
      // data-state mutation — NOT in attributeFilter; should not fire.
      // Even if we change the rect, the MO doesn't notice the
      // attribute change, so no measurement runs, so no FLIP.
      stubRect(el, { x: 99, y: 0, width: 100, height: 100 })
      wrapper.setAttribute("data-state", "active")
      await flushFrame()
      // transform stays empty — no trigger fired.
      expect(el.style.transform ?? "").toBe("")
    })

    it("shares ONE MutationObserver across sibling layout elements (WeakMap cache)", async () => {
      function Component() {
        const m1 = useMotion(() => ({ layout: true }))
        const m2 = useMotion(() => ({ layout: true }))
        return (
          <div data-testid="container">
            <div data-testid="el1" {...m1()} />
            <div data-testid="el2" {...m2()} />
          </div>
        )
      }
      const { container } = render(() => <Component />)
      const wrapper = container.querySelector<HTMLElement>(
        "[data-testid='container']",
      ) as HTMLElement
      const el1 = container.querySelector<HTMLElement>("[data-testid='el1']") as HTMLElement
      const el2 = container.querySelector<HTMLElement>("[data-testid='el2']") as HTMLElement
      stubRect(el1, { x: 0, y: 0, width: 100, height: 100 })
      stubRect(el2, { x: 200, y: 0, width: 100, height: 100 })
      await flushFrame()
      // Move BOTH siblings; one parent-attribute mutation triggers
      // measurements on both controllers.
      stubRect(el1, { x: 10, y: 0, width: 100, height: 100 })
      stubRect(el2, { x: 210, y: 0, width: 100, height: 100 })
      wrapper.setAttribute("style", "padding-left: 10px")
      await flushFrame()
      expect(el1.style.transform).toContain("translateX(-10px)")
      expect(el2.style.transform).toContain("translateX(-10px)")
    })
  })
})
