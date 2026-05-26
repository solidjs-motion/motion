import { render } from "@solidjs/testing-library"
import type { Transition } from "motion"
import { createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MotionConfig } from "../../src/motion-config"
import { LAYOUT_DEFAULT_TRANSITION } from "../../src/primitives/createMotion"
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

// ---------------------------------------------------------------------------
// Layout transition resolution chain.
//
// Layout FLIPs use their OWN transition chain — distinct from the regular
// animate/gesture transition. Chain (lowest → highest priority):
//
//   1. `LAYOUT_DEFAULT_TRANSITION` — library floor
//   2. `<MotionConfig>` transition — workspace-wide default
//   3. element-level `layoutTransition` — per-element override
//
// The element-level `transition` prop is **NOT** in this chain. That prop
// tunes animate/gesture targets; letting it flow into layout caused
// spring configs tuned for hover (e.g., stiffness 300 / damping 30) to
// overshoot when applied to layout FLIPs. Layout has different physics
// needs, so users who want to override it do so via `layoutTransition`
// (per-element) or workspace-wide `<MotionConfig transition>`.
// ---------------------------------------------------------------------------

describe("layout: transition resolution chain", () => {
  it("default — no transition props anywhere → LAYOUT_DEFAULT_TRANSITION", async () => {
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
    expect(firstTransition()).toEqual(LAYOUT_DEFAULT_TRANSITION)
  })

  it("layoutTransition overrides LAYOUT_DEFAULT_TRANSITION on the same key", async () => {
    const [dep, setDep] = createSignal(0)
    function App() {
      const m = useMotion(() => ({
        layout: true,
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

  it("element-level `transition` does NOT flow into layout (independent prop)", async () => {
    // Layout uses its own chain — opts.transition is for animate/gesture
    // targets only. A spring tuned for hover doesn't accidentally control
    // layout FLIP physics. See the file-level rationale.
    const [dep, setDep] = createSignal(0)
    function App() {
      const m = useMotion(() => ({
        layout: true,
        transition: { duration: 999 },
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

    // Layout used the library default, NOT the duration:999 from `transition`.
    expect(firstTransition()).toEqual(LAYOUT_DEFAULT_TRANSITION)
  })

  it("<MotionConfig>.transition flows into layout (workspace-wide default)", async () => {
    const [dep, setDep] = createSignal(0)
    function Inner() {
      const m = useMotion(() => ({ layout: true, layoutDependency: dep }))
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

    // workspace-wide config layered over the library default.
    expect(firstTransition()).toMatchObject({ duration: 2 })
  })

  it("layoutTransition overrides <MotionConfig>.transition on the same key", async () => {
    const [dep, setDep] = createSignal(0)
    function Inner() {
      const m = useMotion(() => ({
        layout: true,
        layoutTransition: { duration: 0.5 },
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

    expect(firstTransition()).toMatchObject({ duration: 0.5 })
  })

  it("full chain merges keys: LAYOUT_DEFAULT + MotionConfig + layoutTransition all contribute", async () => {
    const [dep, setDep] = createSignal(0)
    function Inner() {
      const m = useMotion(() => ({
        layout: true,
        // Different keys at each level — all should appear in the merged result.
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
      // From LAYOUT_DEFAULT_TRANSITION:
      type: LAYOUT_DEFAULT_TRANSITION.type,
      // From <MotionConfig transition>:
      ease: "linear",
      // From layoutTransition (overrides LAYOUT_DEFAULT_TRANSITION.duration):
      duration: 0.5,
    })
  })

  it("reducedMotion=always overrides every layer with { duration: 0 }", async () => {
    const [dep, setDep] = createSignal(0)
    function Inner() {
      const m = useMotion(() => ({
        layout: true,
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

    // mergeLayoutTransition's reduced override strips every other key.
    expect(firstTransition()).toEqual({ duration: 0 })
  })
})
