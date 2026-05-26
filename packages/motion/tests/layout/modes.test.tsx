import { render } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useMotion } from "../../src/use-motion"

// ---------------------------------------------------------------------------
// `motion.animate` stubbed so assertions observe the controller's
// contract without coupling to spring timing.
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
})

afterEach(() => {
  document.documentElement.getBoundingClientRect = originalDocElementRect
})

/**
 * Render a `<motion.div layout={mode}>` whose rect is mocked first to
 * `firstRect` then (after a measurement) to `lastRect`. Returns the
 * element + a function that fires the `layoutDependency` trigger.
 */
async function renderWithRectChange(
  mode: boolean | "position" | "size" | "preserve-aspect",
  firstRect: { x: number; y: number; width: number; height: number },
  lastRect: { x: number; y: number; width: number; height: number },
): Promise<HTMLElement> {
  const [dep, setDep] = createSignal(0)
  function Component() {
    const m = useMotion(() => ({ layout: mode, layoutDependency: dep }))
    return <div data-testid="el" {...m()} />
  }
  const { container } = render(() => <Component />)
  const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
  stubRect(el, firstRect)
  await flushFrame()
  stubRect(el, lastRect)
  setDep(1)
  await flushFrame()
  return el
}

describe("layout mode: true (default — animate position + size)", () => {
  it("writes BOTH translate and scale axes on a combined shift+resize", async () => {
    const el = await renderWithRectChange(
      true,
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 0, width: 200, height: 50 },
    )
    expect(el.style.transform).toContain("translateX(-50px)")
    expect(el.style.transform).toContain("scaleX(0.5)")
    expect(el.style.transform).toContain("scaleY(2)")
  })
})

describe('layout mode: "position"', () => {
  it("writes translates on shift; skips scales even on resize", async () => {
    const el = await renderWithRectChange(
      "position",
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 0, width: 200, height: 50 },
    )
    const t = el.style.transform
    expect(t).toContain("translateX(-50px)")
    // No scale writes — mode excludes them.
    expect(t).not.toContain("scaleX")
    expect(t).not.toContain("scaleY")
  })

  it("applies NO transform when only the element's size changes (no shift)", async () => {
    const el = await renderWithRectChange(
      "position",
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 50 },
    )
    // Mode excludes scale; delta is zero on both axes → translate not
    // fired either. Net: no transform written.
    expect(el.style.transform ?? "").toBe("")
    expect(animateSpy).not.toHaveBeenCalled()
  })
})

describe('layout mode: "size"', () => {
  it("writes scales on resize; skips translates even on shift", async () => {
    const el = await renderWithRectChange(
      "size",
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 0, width: 200, height: 50 },
    )
    const t = el.style.transform
    expect(t).toContain("scaleX(0.5)")
    expect(t).toContain("scaleY(2)")
    expect(t).not.toContain("translateX")
    expect(t).not.toContain("translateY")
  })

  it("applies NO transform when only the element's position changes (no resize)", async () => {
    const el = await renderWithRectChange(
      "size",
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 0, width: 100, height: 100 },
    )
    expect(el.style.transform ?? "").toBe("")
    expect(animateSpy).not.toHaveBeenCalled()
  })
})

describe('layout mode: "preserve-aspect"', () => {
  it("degenerates to uniform scale when invX == invY (same as layout: true for that case)", async () => {
    // 100x100 → 200x200; invX = invY = 0.5. Math.min picks the
    // (equal) common value.
    const el = await renderWithRectChange(
      "preserve-aspect",
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 200 },
    )
    expect(el.style.transform).toContain("scaleX(0.5)")
    expect(el.style.transform).toContain("scaleY(0.5)")
  })

  it("picks the SMALLER inverse scale (Math.min) when one axis changes more than the other", async () => {
    // 100x100 → 200x100. invX = 0.5, invY = 1.0.
    // Math.min(0.5, 1.0) = 0.5 — applied to BOTH axes uniformly.
    // Element at t=0 renders 200*0.5 = 100 wide, 100*0.5 = 50 tall.
    const el = await renderWithRectChange(
      "preserve-aspect",
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 100 },
    )
    expect(el.style.transform).toContain("scaleX(0.5)")
    expect(el.style.transform).toContain("scaleY(0.5)")
  })

  it("writes both translate AND uniform scale on combined shift+asymmetric-resize", async () => {
    // 100x100 → 200x100 at +50,0. invX = 0.5, invY = 1.0 →
    // Math.min = 0.5 uniform. Translate -50 on X.
    const el = await renderWithRectChange(
      "preserve-aspect",
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 0, width: 200, height: 100 },
    )
    const t = el.style.transform
    expect(t).toContain("translateX(-50px)")
    expect(t).toContain("scaleX(0.5)")
    expect(t).toContain("scaleY(0.5)")
  })
})
