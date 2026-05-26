import { render } from "@solidjs/testing-library"
import type { MotionValue } from "motion"
import { createSignal, Show } from "solid-js"
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

describe("layout: layoutId basic handoff", () => {
  it("same-tick handoff: B mounts after A unmounts, FLIPs from A's rect", async () => {
    // Locked Q5 timing: when `<Show>` flips, Solid disposes the old
    // owner FIRST (donor's onCleanup → donate), then creates the new
    // owner (consumer's createMotion → consume retrieves entry). Both
    // happen in the same synchronous flush.
    //
    // A at (100, 100, 200, 200) → B at (500, 500, 100, 100).
    // B's t=0 FLIP renders B at A's position+size:
    //   delta = (100 - 500, 100 - 500) = (-400, -400)
    //   invScale = (200/100, 200/100) = (2, 2)
    const [showA, setShowA] = createSignal(true)
    function A() {
      const m = useMotion(() => ({ layoutId: "card" }))
      return <div data-testid="a" {...m()} />
    }
    function B() {
      const m = useMotion(() => ({ layoutId: "card" }))
      return <div data-testid="b" {...m()} />
    }
    const { container } = render(() => (
      <Show when={showA()} fallback={<B />}>
        <A />
      </Show>
    ))
    const a = container.querySelector<HTMLElement>("[data-testid='a']") as HTMLElement
    stubRect(a, { x: 100, y: 100, width: 200, height: 200 })
    await flushFrame()
    // Swap. A's onCleanup fires (donate); B mounts and consumes.
    setShowA(false)
    const b = container.querySelector<HTMLElement>("[data-testid='b']") as HTMLElement
    stubRect(b, { x: 500, y: 500, width: 100, height: 100 })
    await flushFrame()

    const t = b.style.transform
    expect(t).toContain("translateX(-400px)")
    expect(t).toContain("translateY(-400px)")
    expect(t).toContain("scaleX(2)")
    expect(t).toContain("scaleY(2)")
    // animate stub was called with the expected starting MV value
    // (-400 on x) toward target 0.
    expect(animateSpy).toHaveBeenCalled()
    const xCall = animateSpy.mock.calls.find((c) => {
      const mv = c[0] as MotionValue<number>
      return typeof mv?.get === "function" && mv.get() === -400
    })
    expect(xCall).toBeDefined()
    expect(xCall?.[1]).toBe(0)
  })

  it("no donor: B mounts alone with no prior layoutId → no FLIP fires", async () => {
    const [show, setShow] = createSignal(false)
    function B() {
      const m = useMotion(() => ({ layoutId: "card" }))
      return <div data-testid="b" {...m()} />
    }
    const { container } = render(() => (
      <Show when={show()}>
        <B />
      </Show>
    ))
    setShow(true)
    const b = container.querySelector<HTMLElement>("[data-testid='b']") as HTMLElement
    stubRect(b, { x: 500, y: 500, width: 100, height: 100 })
    await flushFrame()

    // No donor → consume returns null → initialFirst is undefined →
    // B's first measurement establishes baseline → no FLIP.
    expect(b.style.transform ?? "").toBe("")
  })

  it("different layoutId: A's entry doesn't match B's consume → no handoff", async () => {
    const [showA, setShowA] = createSignal(true)
    function A() {
      const m = useMotion(() => ({ layoutId: "card-a" }))
      return <div data-testid="a" {...m()} />
    }
    function B() {
      const m = useMotion(() => ({ layoutId: "card-b" }))
      return <div data-testid="b" {...m()} />
    }
    const { container } = render(() => (
      <Show when={showA()} fallback={<B />}>
        <A />
      </Show>
    ))
    const a = container.querySelector<HTMLElement>("[data-testid='a']") as HTMLElement
    stubRect(a, { x: 100, y: 100, width: 200, height: 200 })
    await flushFrame()
    setShowA(false)
    const b = container.querySelector<HTMLElement>("[data-testid='b']") as HTMLElement
    stubRect(b, { x: 500, y: 500, width: 100, height: 100 })
    await flushFrame()

    // A donated "card-a"; B consumes "card-b" → null → no handoff.
    expect(b.style.transform ?? "").toBe("")
  })
})
