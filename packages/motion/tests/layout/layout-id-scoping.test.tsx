import { render } from "@solidjs/testing-library"
import { createSignal, Show } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LayoutGroup } from "../../src/layout-group"
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

describe("layoutId: LayoutGroup scoping", () => {
  it("handoff inside a single LayoutGroup uses the group's coordinator", async () => {
    // Smoke test: same scenario as layout-id-handoff.test.tsx's same-
    // tick case, but wrapped in `<LayoutGroup>`. Handoff still fires
    // because the group's coordinator is used by both donate and
    // consume.
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
      <LayoutGroup>
        <Show when={showA()} fallback={<B />}>
          <A />
        </Show>
      </LayoutGroup>
    ))
    const a = container.querySelector<HTMLElement>("[data-testid='a']") as HTMLElement
    stubRect(a, { x: 100, y: 100, width: 200, height: 200 })
    await flushFrame()
    setShowA(false)
    const b = container.querySelector<HTMLElement>("[data-testid='b']") as HTMLElement
    stubRect(b, { x: 500, y: 500, width: 100, height: 100 })
    await flushFrame()

    expect(b.style.transform).toContain("translateX(-400px)")
    expect(b.style.transform).toContain("translateY(-400px)")
  })

  it("two parallel LayoutGroups isolate matches — same layoutId in each doesn't cross", async () => {
    // groupA contains donor A. groupB contains consumer B. Each group
    // has its OWN coordinator (step 6 — fresh per LayoutGroup mount).
    // B's consume looks in groupB's coordinator, NOT groupA's →
    // no entry → no handoff.
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
      <>
        <LayoutGroup>
          <Show when={showA()}>
            <A />
          </Show>
        </LayoutGroup>
        <LayoutGroup>
          <Show when={!showA()}>
            <B />
          </Show>
        </LayoutGroup>
      </>
    ))
    const a = container.querySelector<HTMLElement>("[data-testid='a']") as HTMLElement
    stubRect(a, { x: 100, y: 100, width: 200, height: 200 })
    await flushFrame()
    setShowA(false)
    const b = container.querySelector<HTMLElement>("[data-testid='b']") as HTMLElement
    stubRect(b, { x: 500, y: 500, width: 100, height: 100 })
    await flushFrame()

    // No cross-group handoff. B baselines, no FLIP.
    expect(b.style.transform ?? "").toBe("")
  })

  it("layoutId inside a LayoutGroup doesn't match the implicit root coordinator outside", async () => {
    // Donor inside <LayoutGroup>; consumer outside → uses root
    // coordinator. Different coordinators, no match → no handoff.
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
      <>
        <LayoutGroup>
          <Show when={showA()}>
            <A />
          </Show>
        </LayoutGroup>
        <Show when={!showA()}>
          <B />
        </Show>
      </>
    ))
    const a = container.querySelector<HTMLElement>("[data-testid='a']") as HTMLElement
    stubRect(a, { x: 100, y: 100, width: 200, height: 200 })
    await flushFrame()
    setShowA(false)
    const b = container.querySelector<HTMLElement>("[data-testid='b']") as HTMLElement
    stubRect(b, { x: 500, y: 500, width: 100, height: 100 })
    await flushFrame()

    expect(b.style.transform ?? "").toBe("")
  })

  it("nested LayoutGroups shadow normally — inner consumer doesn't see outer donor", async () => {
    // Donor in OUTER LayoutGroup. Consumer in INNER LayoutGroup
    // (nested inside outer's children). Inner's coordinator shadows
    // outer's via Solid context, so consumer's `consume` looks in the
    // inner — finds no entry — no handoff. Confirms context-shadowing
    // applies to the coordinator field.
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
      <LayoutGroup>
        <Show when={showA()}>
          <A />
        </Show>
        <LayoutGroup>
          <Show when={!showA()}>
            <B />
          </Show>
        </LayoutGroup>
      </LayoutGroup>
    ))
    const a = container.querySelector<HTMLElement>("[data-testid='a']") as HTMLElement
    stubRect(a, { x: 100, y: 100, width: 200, height: 200 })
    await flushFrame()
    setShowA(false)
    const b = container.querySelector<HTMLElement>("[data-testid='b']") as HTMLElement
    stubRect(b, { x: 500, y: 500, width: 100, height: 100 })
    await flushFrame()

    // Inner LayoutGroup shadows outer. B looks in inner's
    // coordinator (empty) → no handoff.
    expect(b.style.transform ?? "").toBe("")
  })
})
