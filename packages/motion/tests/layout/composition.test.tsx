import { render } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// `animate` stub — same pattern as other layout test files. Records calls
// but does NOT progress the underlying MV. The user's `animate` target is
// snapshotted into the registry's MV at mount via the initial-target seed
// path; the stub then doesn't move it. That's the value we observe in the
// writer's composed transform.
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

const { useMotion } = await import("../../src/use-motion")
const { createMotionValue } = await import("../../src/primitives/motion-value")

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

describe("layout composition (Plan §10.1)", () => {
  it("layout + animate.x → writer's fold composes user.x + layer.x", async () => {
    // user `animate: { x: 100 }` seeds x in the registry at mount (via
    // the bridge's initial-target transient registration — bridgeActive
    // is forced true because layout is set). Layer.x then ADDS on top
    // via the fold.
    const [dep, setDep] = createSignal(0)
    function App() {
      const m = useMotion(() => ({
        layout: true,
        animate: { x: 100 },
        layoutDependency: dep,
      }))
      return <div data-testid="el" {...m()} />
    }
    const { container } = render(() => <App />)
    const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
    stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()
    stubRect(el, { x: 50, y: 0, width: 100, height: 100 })
    setDep(1)
    await flushFrame()

    // user.x = 100, layer.x = -50 (the FLIP inverse). Folded
    // translateX = 100 + (-50) = 50.
    expect(el.style.transform).toContain("translateX(50px)")
  })

  it("layout + style={{ x: mv }} → writer's fold composes user.MV + layer.x", async () => {
    const [dep, setDep] = createSignal(0)
    const mv = createMotionValue(80)
    function App() {
      const m = useMotion(() => ({ layout: true, layoutDependency: dep }))
      return <div data-testid="el" {...m({ style: { x: mv } })} />
    }
    const { container } = render(() => <App />)
    const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
    stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()
    stubRect(el, { x: 50, y: 0, width: 100, height: 100 })
    setDep(1)
    await flushFrame()

    // user.x (from MV) = 80, layer.x = -50. Folded = 30.
    expect(el.style.transform).toContain("translateX(30px)")
  })

  it("layout + animate.scale → writer's fold expands user.scale and multiplies with layer scales", async () => {
    // user `animate: { scale: 2 }` → registry holds scale = 2. Layout
    // size change → layer.scaleX = layer.scaleY = 0.5. Fold expands
    // the `scale` shortcut into per-axis (deleting the original
    // shortcut) so TRANSFORM_ORDER doesn't double-emit, and multiplies
    // with the layer's inverse → scaleX(1) scaleY(1).
    const [dep, setDep] = createSignal(0)
    function App() {
      const m = useMotion(() => ({
        layout: true,
        animate: { scale: 2 },
        layoutDependency: dep,
      }))
      return <div data-testid="el" {...m()} />
    }
    const { container } = render(() => <App />)
    const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
    // Pure size change (no position shift) so layout's translate
    // block is skipped — only the scale composition matters here.
    stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()
    stubRect(el, { x: 0, y: 0, width: 200, height: 200 })
    setDep(1)
    await flushFrame()

    // Fold expansion: scaleX = 2 * 0.5 = 1, scaleY = 2 * 0.5 = 1.
    // `scale` shortcut deleted to avoid double-application via
    // TRANSFORM_ORDER.
    expect(el.style.transform).toContain("scaleX(1)")
    expect(el.style.transform).toContain("scaleY(1)")
    // Original `scale(2)` must NOT appear — fold dropped it.
    expect(el.style.transform).not.toContain("scale(2)")
  })
})
