import { render } from "@solidjs/testing-library"
import type { MotionValue } from "motion"
import { createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useMotion } from "../../src/use-motion"

// ---------------------------------------------------------------------------
// `motion`'s `animate(mv, target, transition)` is stubbed so we observe the
// controller's contract (set layer MV to inverse, then queue an animation
// toward identity) without coupling test assertions to the spring's
// per-frame progress. The stub just records the call shape; the MV's
// post-`set()` value is what we assert against `el.style.transform`.
// ---------------------------------------------------------------------------

const animateSpy = vi.fn()

vi.mock("motion", async () => {
  const actual = await vi.importActual<typeof import("motion")>("motion")
  return {
    ...actual,
    animate: (...args: unknown[]) => {
      animateSpy(...args)
      // Return a fake controls object satisfying the thenable contract.
      return Object.assign(Promise.resolve(), { stop: () => {}, pause: () => {}, play: () => {} })
    },
  }
})

// ---------------------------------------------------------------------------
// Test infrastructure
//
// `getBoundingClientRect` mocking — jsdom returns all-zero rects by default.
// We override per-test on specific elements; the layout controller measures
// against the projection parent (default = document.documentElement) so we
// always pin that too.
//
// `flushFrame` — awaits two RAF ticks. motion-dom's `frame.read` callbacks
// fire on the next RAF tick; the first await covers Solid's createEffect
// microtask, the second covers the frame.read step.
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
  // Implicit-root projection parent. A fixed origin lets the local-coord
  // math match `E - P` cleanly across tests.
  stubRect(document.documentElement, { x: 0, y: 0, width: 1000, height: 1000 })
  animateSpy.mockClear()
})

afterEach(() => {
  document.documentElement.getBoundingClientRect = originalDocElementRect
})

describe("layout: basic FLIP", () => {
  it("does not fire a FLIP on first measurement (baseline only)", async () => {
    function Component() {
      const m = useMotion(() => ({ layout: true }))
      return <div data-testid="el" {...m()} />
    }
    const { container } = render(() => <Component />)
    const el = container.querySelector<HTMLElement>("[data-testid='el']")
    stubRect(el as HTMLElement, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()
    // No measurement trigger fired (just the baseline pass). transform
    // should be untouched by the layer fold.
    expect(el?.style.transform ?? "").toBe("")
  })

  it("installs layer.x with inverse delta when dependency fires after rect shift", async () => {
    const [dep, setDep] = createSignal(0)
    function Component() {
      const m = useMotion(() => ({ layout: true, layoutDependency: dep }))
      return <div data-testid="el" {...m()} />
    }
    const { container } = render(() => <Component />)
    const el = container.querySelector<HTMLElement>("[data-testid='el']")
    stubRect(el as HTMLElement, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()
    // Move the element 50px right in document coords.
    stubRect(el as HTMLElement, { x: 50, y: 0, width: 100, height: 100 })
    setDep(1)
    await flushFrame()
    // FLIP inverse at t=0: first.x - last.x = 0 - 50 = -50.
    // Writer emits translateX(-50px) (plus translateY(0px) since both
    // axes register when mode === true).
    expect(el?.style.transform).toContain("translateX(-50px)")
    // The animate stub was called with (mv, 0, transition) — the target
    // is identity (0); after the animation completes, transform → 0.
    expect(animateSpy).toHaveBeenCalled()
    const xCall = animateSpy.mock.calls.find((c) => {
      const mv = c[0] as MotionValue<number>
      return typeof mv?.get === "function" && mv.get() === -50
    })
    expect(xCall).toBeDefined()
    expect(xCall?.[1]).toBe(0)
  })

  it("installs layer.y when only Y axis changes", async () => {
    const [dep, setDep] = createSignal(0)
    function Component() {
      const m = useMotion(() => ({ layout: true, layoutDependency: dep }))
      return <div data-testid="el" {...m()} />
    }
    const { container } = render(() => <Component />)
    const el = container.querySelector<HTMLElement>("[data-testid='el']")
    stubRect(el as HTMLElement, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()
    stubRect(el as HTMLElement, { x: 0, y: 30, width: 100, height: 100 })
    setDep(1)
    await flushFrame()
    expect(el?.style.transform).toContain("translateY(-30px)")
  })

  it("installs scaleX / scaleY with inverse-size when element resizes", async () => {
    const [dep, setDep] = createSignal(0)
    function Component() {
      const m = useMotion(() => ({ layout: true, layoutDependency: dep }))
      return <div data-testid="el" {...m()} />
    }
    const { container } = render(() => <Component />)
    const el = container.querySelector<HTMLElement>("[data-testid='el']")
    stubRect(el as HTMLElement, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()
    // Double the width; halve the height. Inverse: scaleX = 0.5, scaleY = 2.
    stubRect(el as HTMLElement, { x: 0, y: 0, width: 200, height: 50 })
    setDep(1)
    await flushFrame()
    expect(el?.style.transform).toContain("scaleX(0.5)")
    expect(el?.style.transform).toContain("scaleY(2)")
  })

  it("does not FLIP on a trigger with no actual rect change (First===Last de-dupe)", async () => {
    const [dep, setDep] = createSignal(0)
    function Component() {
      const m = useMotion(() => ({ layout: true, layoutDependency: dep }))
      return <div data-testid="el" {...m()} />
    }
    const { container } = render(() => <Component />)
    const el = container.querySelector<HTMLElement>("[data-testid='el']")
    stubRect(el as HTMLElement, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()
    // Trigger without rect change.
    setDep(1)
    await flushFrame()
    expect(el?.style.transform ?? "").toBe("")
  })

  describe("modes", () => {
    it('layout="position" — translates only; no scale even on size change', async () => {
      const [dep, setDep] = createSignal(0)
      function Component() {
        const m = useMotion(() => ({ layout: "position", layoutDependency: dep }))
        return <div data-testid="el" {...m()} />
      }
      const { container } = render(() => <Component />)
      const el = container.querySelector<HTMLElement>("[data-testid='el']")
      stubRect(el as HTMLElement, { x: 0, y: 0, width: 100, height: 100 })
      await flushFrame()
      // Shift AND resize.
      stubRect(el as HTMLElement, { x: 50, y: 0, width: 200, height: 100 })
      setDep(1)
      await flushFrame()
      const t = el?.style.transform ?? ""
      expect(t).toContain("translateX(-50px)")
      // No scaleX/scaleY in position mode.
      expect(t).not.toContain("scaleX")
      expect(t).not.toContain("scaleY")
    })

    it('layout="size" — scales only; no translate even on position change', async () => {
      const [dep, setDep] = createSignal(0)
      function Component() {
        const m = useMotion(() => ({ layout: "size", layoutDependency: dep }))
        return <div data-testid="el" {...m()} />
      }
      const { container } = render(() => <Component />)
      const el = container.querySelector<HTMLElement>("[data-testid='el']")
      stubRect(el as HTMLElement, { x: 0, y: 0, width: 100, height: 100 })
      await flushFrame()
      stubRect(el as HTMLElement, { x: 50, y: 0, width: 200, height: 100 })
      setDep(1)
      await flushFrame()
      const t = el?.style.transform ?? ""
      expect(t).toContain("scaleX(0.5)")
      // No translate in size mode.
      expect(t).not.toContain("translateX")
      expect(t).not.toContain("translateY")
    })

    it('layout="preserve-aspect" — uniform scale = Math.min(invX, invY) and position fires', async () => {
      const [dep, setDep] = createSignal(0)
      function Component() {
        const m = useMotion(() => ({ layout: "preserve-aspect", layoutDependency: dep }))
        return <div data-testid="el" {...m()} />
      }
      const { container } = render(() => <Component />)
      const el = container.querySelector<HTMLElement>("[data-testid='el']")
      stubRect(el as HTMLElement, { x: 0, y: 0, width: 100, height: 100 })
      await flushFrame()
      // 100x100 → 200x50; invScaleX = 0.5, invScaleY = 2. Min = 0.5
      // applied uniformly on both axes.
      stubRect(el as HTMLElement, { x: 50, y: 0, width: 200, height: 50 })
      setDep(1)
      await flushFrame()
      const t = el?.style.transform ?? ""
      expect(t).toContain("translateX(-50px)")
      expect(t).toContain("scaleX(0.5)")
      expect(t).toContain("scaleY(0.5)")
    })
  })
})
