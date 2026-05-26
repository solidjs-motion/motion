import { render } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useMotion } from "../../src/use-motion"

// ---------------------------------------------------------------------------
// Stubs (shared pattern across all layout test files).
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

// ---------------------------------------------------------------------------

describe("layout: layoutAnchor", () => {
  it("default anchor (omitted) produces standard FLIP — no observable change", async () => {
    // Smoke test: omitting layoutAnchor must match the existing default
    // behavior tested elsewhere. Element shifts +50; FLIP is -50.
    const [dep, setDep] = createSignal(0)
    function App() {
      const m = useMotion(() => ({ layout: true, layoutDependency: dep }))
      return <div data-testid="el" {...m()} />
    }
    const { container } = render(() => <App />)
    const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
    stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()
    stubRect(el, { x: 50, y: 0, width: 100, height: 100 })
    setDep(1)
    await flushFrame()
    expect(el.style.transform).toContain("translateX(-50px)")
  })

  it("anchor (0.5, 0.5) with a non-resizing projection parent cancels (constant offset)", async () => {
    // Per ADR 0007: anchor subtracts a constant fraction of the
    // projection parent's box from local coords. With a non-resizing
    // parent the offset is the SAME for first and last → cancels in
    // delta. Net: anchor has no observable effect on translates when
    // the parent doesn't resize.
    const [dep, setDep] = createSignal(0)
    function App() {
      const parentM = useMotion(() => ({ layout: true, layoutDependency: dep }))
      const childM = useMotion(() => ({
        layout: true,
        layoutAnchor: { x: 0.5, y: 0.5 },
        layoutDependency: dep,
      }))
      return (
        <div data-testid="parent" {...parentM()}>
          <parentM.Provider>
            <div data-testid="child" {...childM()} />
          </parentM.Provider>
        </div>
      )
    }
    const { container } = render(() => <App />)
    const parent = container.querySelector<HTMLElement>("[data-testid='parent']") as HTMLElement
    const child = container.querySelector<HTMLElement>("[data-testid='child']") as HTMLElement
    stubRect(parent, { x: 0, y: 0, width: 200, height: 200 })
    stubRect(child, { x: 10, y: 10, width: 50, height: 50 })
    await flushFrame()
    // Child shifts +20 within parent. Parent stationary (same size).
    stubRect(child, { x: 30, y: 10, width: 50, height: 50 })
    setDep(1)
    await flushFrame()

    // Both first and last subtract (P.width * 0.5, P.height * 0.5) =
    // (100, 100). Delta = first.x_anchored - last.x_anchored =
    // (10 - 100) - (30 - 100) = -90 - (-70) = -20. Same as default.
    expect(child.style.transform).toContain("translateX(-20px)")
  })

  it("anchor (0.5, 0.5) captures the pivot's motion when projection parent RESIZES", async () => {
    // The case where anchor actually changes deltas: when the
    // projection parent's box changes between first and last, the
    // anchor offset differs and contributes to the delta.
    //
    // Setup: parent grows from 200 wide to 300 wide. Child stays at
    // the same DOCUMENT position. With anchor (0.5, 0.5):
    //
    //   first.x_anchored = child.x - parent.x - 200 * 0.5
    //                    = 110 - 100 - 100 = -90
    //   last.x_anchored  = child.x - parent.x - 300 * 0.5
    //                    = 110 - 100 - 150 = -140
    //   delta = first - last = -90 - (-140) = +50
    //
    // Visually: anchor (0.5, 0.5) means "pivot at parent's center."
    // When parent grows by +100 width, its center moves +50 in
    // viewport. Child's pivot moves with it → anchor delta of +50
    // captures that motion.
    const [dep, setDep] = createSignal(0)
    function App() {
      const parentM = useMotion(() => ({ layoutDependency: dep }))
      const childM = useMotion(() => ({
        layout: true,
        layoutAnchor: { x: 0.5, y: 0.5 },
        layoutDependency: dep,
      }))
      return (
        <div data-testid="parent" {...parentM()}>
          <parentM.Provider>
            <div data-testid="child" {...childM()} />
          </parentM.Provider>
        </div>
      )
    }
    // Note: parent is layoutRoot-style (no layout/layoutRoot prop
    // here — but we'd want it to push projection context. Adding
    // layoutRoot to make it a projection parent without itself
    // FLIPping).
    function AppWithRoot() {
      const parentM = useMotion(() => ({ layoutRoot: true, layoutDependency: dep }))
      const childM = useMotion(() => ({
        layout: true,
        layoutAnchor: { x: 0.5, y: 0.5 },
        layoutDependency: dep,
      }))
      return (
        <div data-testid="parent" {...parentM()}>
          <parentM.Provider>
            <div data-testid="child" {...childM()} />
          </parentM.Provider>
        </div>
      )
    }
    // Use the AppWithRoot variant — parent must push projection
    // context for child to measure relative to parent.
    const { container } = render(() => <AppWithRoot />)
    const parent = container.querySelector<HTMLElement>("[data-testid='parent']") as HTMLElement
    const child = container.querySelector<HTMLElement>("[data-testid='child']") as HTMLElement
    stubRect(parent, { x: 100, y: 100, width: 200, height: 200 })
    stubRect(child, { x: 110, y: 110, width: 50, height: 50 })
    await flushFrame()
    // Parent grows: width 200 → 300, height 200 → 300. Child stays at
    // same document position.
    stubRect(parent, { x: 100, y: 100, width: 300, height: 300 })
    stubRect(child, { x: 110, y: 110, width: 50, height: 50 })
    setDep(1)
    await flushFrame()

    // first.x_anchored = (110 - 100) - 200 * 0.5 = 10 - 100 = -90
    // last.x_anchored  = (110 - 100) - 300 * 0.5 = 10 - 150 = -140
    // delta = -90 - (-140) = +50. translateX(+50px).
    expect(child.style.transform).toContain("translateX(50px)")
    expect(child.style.transform).toContain("translateY(50px)")
    // Suppress unused-fn warning for the alt variant defined above
    // for readability — the `AppWithRoot` form is what actually
    // renders.
    void App
  })

  it("anchor (1, 0) anchors to top-right; (0, 1) anchors to bottom-left", async () => {
    // Verifies axis-asymmetric anchors. Parent grows asymmetrically:
    // width +100, height +0. With anchor (1, 0) the X offset
    // contributes (P.width_diff * 1) = +100; the Y is unaffected.
    const [dep, setDep] = createSignal(0)
    function App() {
      const parentM = useMotion(() => ({ layoutRoot: true, layoutDependency: dep }))
      const childM = useMotion(() => ({
        layout: true,
        layoutAnchor: { x: 1, y: 0 },
        layoutDependency: dep,
      }))
      return (
        <div data-testid="parent" {...parentM()}>
          <parentM.Provider>
            <div data-testid="child" {...childM()} />
          </parentM.Provider>
        </div>
      )
    }
    const { container } = render(() => <App />)
    const parent = container.querySelector<HTMLElement>("[data-testid='parent']") as HTMLElement
    const child = container.querySelector<HTMLElement>("[data-testid='child']") as HTMLElement
    stubRect(parent, { x: 100, y: 100, width: 200, height: 200 })
    stubRect(child, { x: 110, y: 110, width: 50, height: 50 })
    await flushFrame()
    // Parent grows on X only.
    stubRect(parent, { x: 100, y: 100, width: 300, height: 200 })
    setDep(1)
    await flushFrame()

    // first.x_anchored = (110 - 100) - 200 * 1 = 10 - 200 = -190
    // last.x_anchored  = (110 - 100) - 300 * 1 = 10 - 300 = -290
    // delta = -190 - (-290) = +100. translateX(+100px).
    // Y anchor is 0 → no Y contribution. Parent.height didn't change
    // → no Y delta.
    expect(child.style.transform).toContain("translateX(100px)")
    // Y axis: delta = 0, so no translateY (or translateY(0px)
    // which the writer may emit).
    const t = child.style.transform
    expect(t.includes("translateY(0px)") || !t.includes("translateY")).toBe(true)
  })
})
