import { render } from "@solidjs/testing-library"
import type { Transition } from "motion"
import { createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MotionConfig } from "../../src/motion-config"
import { useMotion } from "../../src/use-motion"

// ---------------------------------------------------------------------------
// Stubs (shared pattern across layout test files).
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
  // matchMedia is referenced by createReducedMotion via from(matchMedia(...));
  // stub for the reduced-motion test.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  document.documentElement.getBoundingClientRect = originalDocElementRect
  delete (window as Partial<Window>).matchMedia
})

/** Returns the transition argument from the FIRST animate call. */
const firstTransition = (): Transition | undefined => {
  const call = animateSpy.mock.calls[0]
  return call?.[2] as Transition | undefined
}

// ---------------------------------------------------------------------------

describe("layout: transition resolution chain (Plan §3 / Q9 lock)", () => {
  it("default — no transition props anywhere → empty merged transition", async () => {
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

    expect(animateSpy).toHaveBeenCalled()
    expect(firstTransition()).toEqual({})
  })

  it("layoutTransition overrides element.transition on the same key", async () => {
    const [dep, setDep] = createSignal(0)
    function App() {
      const m = useMotion(() => ({
        layout: true,
        transition: { duration: 1 },
        layoutTransition: { duration: 0.5 },
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

    expect(firstTransition()).toMatchObject({ duration: 0.5 })
  })

  it("element.transition overrides <MotionConfig>.transition on the same key", async () => {
    const [dep, setDep] = createSignal(0)
    function Inner() {
      const m = useMotion(() => ({
        layout: true,
        transition: { duration: 1 },
        layoutDependency: dep,
      }))
      return <div data-testid="el" {...m()} />
    }
    const { container } = render(() => (
      <MotionConfig transition={{ duration: 2 }}>
        <Inner />
      </MotionConfig>
    ))
    const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
    stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()
    stubRect(el, { x: 50, y: 0, width: 100, height: 100 })
    setDep(1)
    await flushFrame()

    expect(firstTransition()).toMatchObject({ duration: 1 })
  })

  it("full chain merges keys: MotionConfig + element.transition + layoutTransition all contribute", async () => {
    const [dep, setDep] = createSignal(0)
    function Inner() {
      const m = useMotion(() => ({
        layout: true,
        // Different keys at each level — all should appear in the merged result.
        transition: { type: "spring" },
        layoutTransition: { duration: 0.5 },
        layoutDependency: dep,
      }))
      return <div data-testid="el" {...m()} />
    }
    const { container } = render(() => (
      <MotionConfig transition={{ ease: "linear" }}>
        <Inner />
      </MotionConfig>
    ))
    const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
    stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()
    stubRect(el, { x: 50, y: 0, width: 100, height: 100 })
    setDep(1)
    await flushFrame()

    expect(firstTransition()).toMatchObject({
      ease: "linear",
      type: "spring",
      duration: 0.5,
    })
  })

  it("reducedMotion=always overrides every layer with { duration: 0 }", async () => {
    const [dep, setDep] = createSignal(0)
    function Inner() {
      const m = useMotion(() => ({
        layout: true,
        transition: { duration: 1 },
        layoutTransition: { duration: 5 },
        layoutDependency: dep,
      }))
      return <div data-testid="el" {...m()} />
    }
    const { container } = render(() => (
      <MotionConfig reducedMotion="always" transition={{ duration: 10 }}>
        <Inner />
      </MotionConfig>
    ))
    const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
    stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()
    stubRect(el, { x: 50, y: 0, width: 100, height: 100 })
    setDep(1)
    await flushFrame()

    // mergeTransition's reduced override strips every other key.
    expect(firstTransition()).toEqual({ duration: 0 })
  })
})
