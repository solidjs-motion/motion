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

/**
 * Mock scroll offsets on an element. jsdom doesn't simulate scroll
 * positions, so we override via `Object.defineProperty` getters.
 */
const stubScroll = (el: Element, scrollLeft: number, scrollTop = 0): void => {
  Object.defineProperty(el, "scrollLeft", { get: () => scrollLeft, configurable: true })
  Object.defineProperty(el, "scrollTop", { get: () => scrollTop, configurable: true })
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

describe("layout: layoutScroll", () => {
  it("scroll-only change to the container does NOT trigger a FLIP (compensation cancels)", async () => {
    const [dep, setDep] = createSignal(0)
    function App() {
      const containerM = useMotion(() => ({ layoutScroll: true, layoutDependency: dep }))
      const childM = useMotion(() => ({ layout: true, layoutDependency: dep }))
      return (
        <div data-testid="container" {...containerM()}>
          <containerM.Provider>
            <div data-testid="child" {...childM()} />
          </containerM.Provider>
        </div>
      )
    }
    const { container } = render(() => <App />)
    const cont = container.querySelector<HTMLElement>("[data-testid='container']") as HTMLElement
    const child = container.querySelector<HTMLElement>("[data-testid='child']") as HTMLElement
    // Initial: container at viewport (0, 0, 200, 200); scrollLeft 0.
    // Child at (10, 10) — relative to documentElement (the implicit
    // projection parent, since container only has layoutScroll).
    stubRect(cont, { x: 0, y: 0, width: 200, height: 200 })
    stubRect(child, { x: 10, y: 10, width: 50, height: 50 })
    stubScroll(cont, 0)
    await flushFrame()
    // Container scrolls 30px right. Content inside shifts -30 in
    // viewport. Child's bcr now reports (-20, 10). scrollLeft = 30.
    stubRect(child, { x: -20, y: 10, width: 50, height: 50 })
    stubScroll(cont, 30)
    setDep(1)
    await flushFrame()

    // Compensation: localX = (-20) - 0 + 30 = 10. Same as before
    // (10 - 0 + 0 = 10). No actual layout change → no FLIP.
    expect(child.style.transform ?? "").toBe("")
  })

  it("compensates scroll AND captures layout shift independently", async () => {
    const [dep, setDep] = createSignal(0)
    function App() {
      const containerM = useMotion(() => ({ layoutScroll: true, layoutDependency: dep }))
      const childM = useMotion(() => ({ layout: true, layoutDependency: dep }))
      return (
        <div data-testid="container" {...containerM()}>
          <containerM.Provider>
            <div data-testid="child" {...childM()} />
          </containerM.Provider>
        </div>
      )
    }
    const { container } = render(() => <App />)
    const cont = container.querySelector<HTMLElement>("[data-testid='container']") as HTMLElement
    const child = container.querySelector<HTMLElement>("[data-testid='child']") as HTMLElement
    stubRect(cont, { x: 0, y: 0, width: 200, height: 200 })
    stubRect(child, { x: 10, y: 10, width: 50, height: 50 })
    stubScroll(cont, 0)
    await flushFrame()
    // Scroll +30 AND child layout-shifts +20 within container. Viewport
    // bcr: (10 + 20 - 30) = 0. scrollLeft = 30.
    stubRect(child, { x: 0, y: 10, width: 50, height: 50 })
    stubScroll(cont, 30)
    setDep(1)
    await flushFrame()

    // Compensation: localX = 0 - 0 + 30 = 30. First local = 10.
    // Delta = 10 - 30 = -20. Translate -20 (the genuine layout shift,
    // scroll cancelled out).
    expect(child.style.transform).toContain("translateX(-20px)")
  })

  it("layout AND layoutScroll on the same container — compensation still applies", async () => {
    // When container has BOTH `layout` AND `layoutScroll`, the chain
    // resets to `[container]` (per Q-layoutScroll's chain-reset rule).
    // Descendants measure against container with its scroll
    // compensated.
    const [dep, setDep] = createSignal(0)
    function App() {
      const containerM = useMotion(() => ({
        layout: true,
        layoutScroll: true,
        layoutDependency: dep,
      }))
      const childM = useMotion(() => ({ layout: true, layoutDependency: dep }))
      return (
        <div data-testid="container" {...containerM()}>
          <containerM.Provider>
            <div data-testid="child" {...childM()} />
          </containerM.Provider>
        </div>
      )
    }
    const { container } = render(() => <App />)
    const cont = container.querySelector<HTMLElement>("[data-testid='container']") as HTMLElement
    const child = container.querySelector<HTMLElement>("[data-testid='child']") as HTMLElement
    stubRect(cont, { x: 0, y: 0, width: 200, height: 200 })
    stubRect(child, { x: 10, y: 10, width: 50, height: 50 })
    stubScroll(cont, 0)
    await flushFrame()
    // Container stationary; scroll +30; child layout-shifts +20.
    stubRect(child, { x: 0, y: 10, width: 50, height: 50 })
    stubScroll(cont, 30)
    setDep(1)
    await flushFrame()

    // Container has no actual layout change → no FLIP on container.
    expect(cont.style.transform ?? "").toBe("")
    // Child's compensated local: 0 - 0 + 30 = 30. First was 10.
    // Delta -20. translateX(-20).
    expect(child.style.transform).toContain("translateX(-20px)")
  })

  it("outer layoutScroll ABOVE a layout ancestor does NOT add compensation (chain RESET)", async () => {
    // Three-level nesting: outer (layoutScroll only) → middle (layout)
    // → leaf (layout). Per the chain-reset rule:
    //   - outer pushes context with scrollAncestors = [outer].
    //   - middle pushes context with scrollAncestors = [] (RESET —
    //     outer's scroll shifts both middle AND leaf equally, so it
    //     cancels via the E-P math; including it in leaf's chain
    //     would OVER-COMPENSATE).
    //   - leaf measures against middle with chain = [].
    //
    // Setup: outer.scroll = 30 shifts middle and leaf in viewport by
    // -30. Leaf ALSO shifts +20 within middle (content coords). With
    // chain reset: delta = +20 (correct). Without reset: delta would
    // pick up outer.scrollLeft = +30 over-compensation → wrong answer.
    const [dep, setDep] = createSignal(0)
    function App() {
      const outerM = useMotion(() => ({ layoutScroll: true, layoutDependency: dep }))
      const middleM = useMotion(() => ({ layout: true, layoutDependency: dep }))
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
    stubRect(outer, { x: 0, y: 0, width: 400, height: 400 })
    stubRect(middle, { x: 100, y: 100, width: 200, height: 200 })
    stubRect(leaf, { x: 110, y: 110, width: 50, height: 50 })
    stubScroll(outer, 0)
    await flushFrame()
    // outer scrolls +30; middle and leaf shift by -30 in viewport
    // (outer is the scroll container). Leaf ALSO layout-shifts +20
    // within middle (so its viewport position is initial + 20 - 30 =
    // initial - 10).
    stubRect(middle, { x: 70, y: 100, width: 200, height: 200 })
    stubRect(leaf, { x: 100, y: 110, width: 50, height: 50 })
    stubScroll(outer, 30)
    setDep(1)
    await flushFrame()

    // leaf measures against middle (its projection parent). Chain = []
    // because middle's `layout` push reset it. Local = (100 - 70, 0) =
    // (30, 0). First local = (10, 0). Delta = -20.
    expect(leaf.style.transform).toContain("translateX(-20px)")
    // If chain reset were broken and outer.scrollLeft (30) were also
    // added, delta would be -50 — verifying the correct value above
    // distinguishes the two implementations.
  })
})
