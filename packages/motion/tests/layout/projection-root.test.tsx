import { render } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useMotion } from "../../src/use-motion"

// ---------------------------------------------------------------------------
// Stubs (same pattern as the other layout test files).
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

describe("layout: layoutRoot", () => {
  it("layoutRoot pushes projection context but does NOT FLIP itself", async () => {
    const [dep, setDep] = createSignal(0)
    function App() {
      const rootM = useMotion(() => ({ layoutRoot: true, layoutDependency: dep }))
      const childM = useMotion(() => ({ layout: true, layoutDependency: dep }))
      return (
        <div data-testid="root" {...rootM()}>
          <rootM.Provider>
            <div data-testid="child" {...childM()} />
          </rootM.Provider>
        </div>
      )
    }
    const { container } = render(() => <App />)
    const root = container.querySelector<HTMLElement>("[data-testid='root']") as HTMLElement
    const child = container.querySelector<HTMLElement>("[data-testid='child']") as HTMLElement
    stubRect(root, { x: 100, y: 100, width: 500, height: 500 })
    stubRect(child, { x: 110, y: 110, width: 50, height: 50 })
    await flushFrame()
    // Both shift together. With layoutRoot pushing the projection
    // context, child measures against root and sees a zero local-coord
    // delta (relative position unchanged).
    stubRect(root, { x: 150, y: 100, width: 500, height: 500 })
    stubRect(child, { x: 160, y: 110, width: 50, height: 50 })
    setDep(1)
    await flushFrame()

    // Root has no `layout` prop, so no controller is installed → no
    // FLIP on root, no `animateSpy` call on root.
    expect(root.style.transform ?? "").toBe("")
    // Child measures against root (the layoutRoot push); parent-
    // relative delta is zero → no FLIP.
    expect(child.style.transform ?? "").toBe("")
  })

  it("layoutRoot OVERRIDES an outer `layout` ancestor's projection parent", async () => {
    // Three-level nesting:
    //   outer (layout)            — pushes itself as projection parent.
    //   middle (layoutRoot)       — RE-PUSHES itself; descendants see middle.
    //   leaf (layout)             — measures against middle, NOT outer.
    //
    // Setup designed so the answer differs between "leaf measures
    // against outer" vs "leaf measures against middle":
    //
    //   - outer shifts by +50 on X.
    //   - middle is stationary (simulates a fixed-positioned panel that
    //     doesn't move with outer — the layoutRoot use case).
    //   - leaf shifts by +20 within middle.
    //
    // Expected with layoutRoot:
    //   - outer FLIPs by -50 (against documentElement).
    //   - middle has no `layout` prop → no FLIP, transform empty.
    //   - leaf FLIPs by -20 (middle-relative). NOT -50 (which would
    //     be the outer-relative answer if layoutRoot didn't override).
    const [dep, setDep] = createSignal(0)
    function App() {
      const outerM = useMotion(() => ({ layout: true, layoutDependency: dep }))
      const middleM = useMotion(() => ({ layoutRoot: true, layoutDependency: dep }))
      const leafM = useMotion(() => ({ layout: true, layoutDependency: dep }))
      return (
        <div data-testid="outer" {...outerM()}>
          <outerM.Provider>
            <div data-testid="middle" {...middleM()}>
              <middleM.Provider>
                <div data-testid="leaf" {...leafM()} />
              </middleM.Provider>
            </div>
          </outerM.Provider>
        </div>
      )
    }
    const { container } = render(() => <App />)
    const outer = container.querySelector<HTMLElement>("[data-testid='outer']") as HTMLElement
    const middle = container.querySelector<HTMLElement>("[data-testid='middle']") as HTMLElement
    const leaf = container.querySelector<HTMLElement>("[data-testid='leaf']") as HTMLElement
    stubRect(outer, { x: 0, y: 0, width: 1000, height: 1000 })
    stubRect(middle, { x: 100, y: 100, width: 500, height: 500 })
    stubRect(leaf, { x: 110, y: 110, width: 50, height: 50 })
    await flushFrame()
    // outer shifts; middle stationary (simulating fixed positioning);
    // leaf shifts +20 within middle.
    stubRect(outer, { x: 50, y: 0, width: 1000, height: 1000 })
    stubRect(middle, { x: 100, y: 100, width: 500, height: 500 })
    stubRect(leaf, { x: 130, y: 110, width: 50, height: 50 })
    setDep(1)
    await flushFrame()

    expect(outer.style.transform).toContain("translateX(-50px)")
    expect(middle.style.transform ?? "").toBe("")
    // The load-bearing assertion: leaf's delta is middle-relative
    // (-20), NOT outer-relative (which would be -30 if leaf measured
    // against outer).
    expect(leaf.style.transform).toContain("translateX(-20px)")
  })

  it("layout AND layoutRoot together — element FLIPs itself AND pushes as projection parent (risk #9)", async () => {
    const [dep, setDep] = createSignal(0)
    function App() {
      const rootM = useMotion(() => ({
        layout: true,
        layoutRoot: true,
        layoutDependency: dep,
      }))
      const childM = useMotion(() => ({ layout: true, layoutDependency: dep }))
      return (
        <div data-testid="root" {...rootM()}>
          <rootM.Provider>
            <div data-testid="child" {...childM()} />
          </rootM.Provider>
        </div>
      )
    }
    const { container } = render(() => <App />)
    const root = container.querySelector<HTMLElement>("[data-testid='root']") as HTMLElement
    const child = container.querySelector<HTMLElement>("[data-testid='child']") as HTMLElement
    stubRect(root, { x: 100, y: 100, width: 500, height: 500 })
    stubRect(child, { x: 110, y: 110, width: 50, height: 50 })
    await flushFrame()
    // Both shift together. Root FLIPs (it has `layout`); child does
    // NOT FLIP (parent-relative is stable — root is its projection
    // parent because of the `layoutRoot` flag).
    stubRect(root, { x: 150, y: 100, width: 500, height: 500 })
    stubRect(child, { x: 160, y: 110, width: 50, height: 50 })
    setDep(1)
    await flushFrame()

    expect(root.style.transform).toContain("translateX(-50px)")
    expect(child.style.transform ?? "").toBe("")
  })
})
