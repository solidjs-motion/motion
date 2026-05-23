import { render } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useMotion } from "../../src/use-motion"

// ---------------------------------------------------------------------------
// Stubs (same shape as basic-flip / triggers / modes test files).
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

describe("layout: nested via projection context", () => {
  it("nested parent+child do NOT over-correct when both shift together (Approach 2 regression)", async () => {
    // The canonical motivation for ADR 0007's projection-parent-local
    // coordinates. Parent shifts by 50px; child shifts with parent (no
    // relative motion). Without this fix the child would measure
    // against `document.documentElement` (the implicit-root default)
    // and see its OWN viewport-coord shift of -50, applying a SECOND
    // inverse on top of the parent's invert — visually over-correcting
    // by 50px on top of the parent's already-correct invert.
    const [dep, setDep] = createSignal(0)
    function App() {
      const parentM = useMotion(() => ({ layout: true, layoutDependency: dep }))
      const childM = useMotion(() => ({ layout: true, layoutDependency: dep }))
      return (
        <div data-testid="root">
          <div data-testid="parent" {...parentM()}>
            <parentM.Provider>
              <div data-testid="child" {...childM()} />
            </parentM.Provider>
          </div>
        </div>
      )
    }
    const { container } = render(() => <App />)
    const parent = container.querySelector<HTMLElement>("[data-testid='parent']") as HTMLElement
    const child = container.querySelector<HTMLElement>("[data-testid='child']") as HTMLElement
    stubRect(parent, { x: 100, y: 100, width: 200, height: 200 })
    stubRect(child, { x: 110, y: 110, width: 50, height: 50 })
    await flushFrame()
    // Both shift by 50px on X. Child's PARENT-RELATIVE position is
    // unchanged ((110-100, 110-100) = (10, 10) → (160-150, 110-100) =
    // (10, 10)).
    stubRect(parent, { x: 150, y: 100, width: 200, height: 200 })
    stubRect(child, { x: 160, y: 110, width: 50, height: 50 })
    setDep(1)
    await flushFrame()

    // Parent FLIPs by -50 (its document-relative delta).
    expect(parent.style.transform).toContain("translateX(-50px)")
    // Child does NOT FLIP — its parent-relative local-coord delta is
    // zero. With a world-coord measurement (the bug Approach 2 fixes)
    // child would over-correct with translateX(-50px) on top of
    // parent's invert.
    expect(child.style.transform ?? "").toBe("")
  })

  it("child FLIPs by parent-relative delta when child moves WITHIN parent", async () => {
    const [dep, setDep] = createSignal(0)
    function App() {
      const parentM = useMotion(() => ({ layout: true, layoutDependency: dep }))
      const childM = useMotion(() => ({ layout: true, layoutDependency: dep }))
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
    // Parent stationary. Child moves by +20 on X within parent.
    // Parent-relative: (10, 10) → (30, 10). Local delta = -20 on X.
    stubRect(child, { x: 130, y: 110, width: 50, height: 50 })
    setDep(1)
    await flushFrame()

    expect(parent.style.transform ?? "").toBe("")
    expect(child.style.transform).toContain("translateX(-20px)")
  })

  it("parent and child FLIP by their own deltas when both move independently", async () => {
    const [dep, setDep] = createSignal(0)
    function App() {
      const parentM = useMotion(() => ({ layout: true, layoutDependency: dep }))
      const childM = useMotion(() => ({ layout: true, layoutDependency: dep }))
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
    // Parent shifts by 50; child shifts by 60 in document coords →
    // 10 in parent-relative coords (child shifted +10 within parent).
    stubRect(parent, { x: 150, y: 100, width: 200, height: 200 })
    stubRect(child, { x: 170, y: 110, width: 50, height: 50 })
    setDep(1)
    await flushFrame()

    // Parent's delta: document-relative (parent's projection parent is
    // documentElement by default).
    expect(parent.style.transform).toContain("translateX(-50px)")
    // Child's delta: parent-relative. (110-100, 110-100)=(10,10) →
    // (170-150, 110-100)=(20,10). Local delta = (-10, 0).
    expect(child.style.transform).toContain("translateX(-10px)")
  })

  it("WITHOUT m.Provider wrap — child falls back to document.documentElement (locked semantics)", async () => {
    // Q3 lock: useMotion direct-use opts in via m.Provider. Without
    // it, descendant layout elements silently use the implicit-root
    // projection parent. This test pins the documented footgun: same
    // shift-together scenario as the first test, but with no Provider
    // wrap — child DOES over-correct.
    const [dep, setDep] = createSignal(0)
    function App() {
      const parentM = useMotion(() => ({ layout: true, layoutDependency: dep }))
      const childM = useMotion(() => ({ layout: true, layoutDependency: dep }))
      return (
        <div data-testid="parent" {...parentM()}>
          {/* NO <parentM.Provider> wrap — child uses default context. */}
          <div data-testid="child" {...childM()} />
        </div>
      )
    }
    const { container } = render(() => <App />)
    const parent = container.querySelector<HTMLElement>("[data-testid='parent']") as HTMLElement
    const child = container.querySelector<HTMLElement>("[data-testid='child']") as HTMLElement
    stubRect(parent, { x: 100, y: 100, width: 200, height: 200 })
    stubRect(child, { x: 110, y: 110, width: 50, height: 50 })
    await flushFrame()
    stubRect(parent, { x: 150, y: 100, width: 200, height: 200 })
    stubRect(child, { x: 160, y: 110, width: 50, height: 50 })
    setDep(1)
    await flushFrame()

    // Both elements FLIP. Child measures against documentElement, sees
    // its own viewport-coord shift of -50, and applies an inverse.
    // This is the "world-coord over-correction" behavior — load-bearing
    // FOOTGUN that the proxy's auto-Provider-wrap (Phase 4) prevents
    // by default.
    expect(parent.style.transform).toContain("translateX(-50px)")
    expect(child.style.transform).toContain("translateX(-50px)")
  })
})
