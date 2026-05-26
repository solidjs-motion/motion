import { render } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// `animate` stubbed with a synchronous-thenable controls so
// `Promise.all(controls).then(...)` resolves on the next microtask flush.
// (Same pattern as Presence tests — see tests/presence.test.tsx.)
// ---------------------------------------------------------------------------

const animateSpy = vi.fn((..._args: unknown[]) => ({
  stop: vi.fn(),
  pause: vi.fn(),
  play: vi.fn(),
  cancel: vi.fn(),
  complete: vi.fn(),
  // biome-ignore lint/suspicious/noThenProperty: motion's AnimationPlaybackControls is intentionally thenable
  then: (resolve: () => void) => {
    resolve()
    return Promise.resolve()
  },
}))

vi.mock("motion", async () => {
  const actual = await vi.importActual<typeof import("motion")>("motion")
  return { ...actual, animate: animateSpy }
})

const { useMotion } = await import("../../src/use-motion")

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

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

describe("layout: lifecycle callbacks", () => {
  it("fires onLayoutAnimationStart synchronously when a FLIP dispatches", async () => {
    const onStart = vi.fn()
    const [dep, setDep] = createSignal(0)
    function App() {
      const m = useMotion(() => ({
        layout: true,
        layoutDependency: dep,
        onLayoutAnimationStart: onStart,
      }))
      return <div data-testid="el" {...m()} />
    }
    const { container } = render(() => <App />)
    const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
    stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()

    // No FLIP yet — baseline pass only.
    expect(onStart).not.toHaveBeenCalled()

    stubRect(el, { x: 50, y: 0, width: 100, height: 100 })
    setDep(1)
    await flushFrame()

    // FLIP dispatched.
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it("fires onLayoutAnimationComplete after every axis's animate resolves", async () => {
    const onComplete = vi.fn()
    const [dep, setDep] = createSignal(0)
    function App() {
      const m = useMotion(() => ({
        layout: true,
        layoutDependency: dep,
        onLayoutAnimationComplete: onComplete,
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
    // Promise.all resolves on the next microtask flush after the
    // animate thenables fire synchronously.
    await flush()

    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("does NOT fire callbacks when no FLIP runs (baseline + de-dupe)", async () => {
    const onStart = vi.fn()
    const onComplete = vi.fn()
    const [dep, setDep] = createSignal(0)
    function App() {
      const m = useMotion(() => ({
        layout: true,
        layoutDependency: dep,
        onLayoutAnimationStart: onStart,
        onLayoutAnimationComplete: onComplete,
      }))
      return <div data-testid="el" {...m()} />
    }
    const { container } = render(() => <App />)
    const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
    stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()
    // Trigger without rect change. First === Last → de-dupe.
    setDep(1)
    await flushFrame()
    await flush()

    expect(onStart).not.toHaveBeenCalled()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it("fires callbacks once per FLIP across multiple trigger cycles", async () => {
    const onStart = vi.fn()
    const onComplete = vi.fn()
    const [dep, setDep] = createSignal(0)
    function App() {
      const m = useMotion(() => ({
        layout: true,
        layoutDependency: dep,
        onLayoutAnimationStart: onStart,
        onLayoutAnimationComplete: onComplete,
      }))
      return <div data-testid="el" {...m()} />
    }
    const { container } = render(() => <App />)
    const el = container.querySelector<HTMLElement>("[data-testid='el']") as HTMLElement
    stubRect(el, { x: 0, y: 0, width: 100, height: 100 })
    await flushFrame()
    // First FLIP.
    stubRect(el, { x: 50, y: 0, width: 100, height: 100 })
    setDep(1)
    await flushFrame()
    await flush()
    // Second FLIP.
    stubRect(el, { x: 80, y: 0, width: 100, height: 100 })
    setDep(2)
    await flushFrame()
    await flush()

    expect(onStart).toHaveBeenCalledTimes(2)
    expect(onComplete).toHaveBeenCalledTimes(2)
  })
})
