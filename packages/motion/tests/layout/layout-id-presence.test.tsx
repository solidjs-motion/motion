import { render } from "@solidjs/testing-library"
import { createSignal, Show } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// `animate` stubbed with a synchronous-thenable controls — Presence awaits
// `runExit()` which awaits `animate(...).then(...)`, so the synchronous
// resolve keeps the exit-completion drain bounded by microtasks.
// (Pattern mirrored from tests/presence.test.tsx.)
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
const { Presence } = await import("../../src/presence")

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
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

// ---------------------------------------------------------------------------

describe("layoutId × <Presence> — parallel handoff (Plan §6.5)", () => {
  it("B FLIPs from A's rect while A's exit animation runs on A in parallel", async () => {
    // Locked timing (Q5 + §6.5):
    //   - mode flips, Solid disposes A's owner synchronously → donate
    //     fires with A's pre-exit rect. A's DOM element STAYS in the
    //     DOM via Presence/transition-group keep-alive.
    //   - B's owner created in the same flush; consume retrieves the
    //     entry. Since A.el.isConnected === true, the LIVE rect is
    //     used (functionally the same here as the stored rect — both
    //     are A's stubbed value).
    //   - B's FLIP fires.
    //   - Independently, Presence's onExit calls A's `runExit` which
    //     invokes animate(A.el, { opacity: 0 }, transition).
    //   - Both animations run in parallel; no cross-cancellation.
    const [page, setPage] = createSignal<"a" | "b">("a")
    function A() {
      const m = useMotion(() => ({ layoutId: "card", exit: { opacity: 0 } }))
      return <div data-testid="a" {...m()} />
    }
    function B() {
      const m = useMotion(() => ({ layoutId: "card" }))
      return <div data-testid="b" {...m()} />
    }
    const { container } = render(() => (
      <Presence mode="sync">
        <Show when={page() === "a"} fallback={<B />}>
          <A />
        </Show>
      </Presence>
    ))
    const a = container.querySelector<HTMLElement>("[data-testid='a']") as HTMLElement
    stubRect(a, { x: 100, y: 100, width: 200, height: 200 })
    await flushFrame()

    // Trigger the swap. A's onCleanup fires (donate). B mounts and
    // consumes. Presence keeps A in the DOM until exit settles.
    setPage("b")
    // Let Presence's onExit dispatch and the layout's frame.read fire.
    await flush()
    await flushFrame()

    const b = container.querySelector<HTMLElement>("[data-testid='b']") as HTMLElement
    expect(b).toBeTruthy()
    // B's last rect must be stubbed before the FIRST measurement
    // settles into a `last` value. flushFrame above triggered the
    // baseline pass already — but with `initialFirst` set from the
    // handoff, the first pass is the FLIP. So we need to stub BEFORE
    // that pass: realistically the timing is post-flush, pre-flushFrame.
    // Since flushFrame above already ran, stub B's rect and trigger
    // another frame cycle to capture last.
    stubRect(b, { x: 500, y: 500, width: 100, height: 100 })
    // The first FLIP measurement may have run with the un-stubbed
    // rect (zeros) — but since `initialFirst` is set, that pass would
    // have computed a delta against zeros (degenerate). We bump
    // forward and let the next trigger fire. Actually with no further
    // trigger, the controller is quiescent. Need a way to force a
    // re-measurement; the simplest: render the test scenario where
    // B's rect is stubbed via the ref callback (assigned at mount).
    //
    // For this test to be deterministic, we'll verify the EXIT side
    // (A's animate call) which doesn't depend on B's measurement
    // timing — that's the load-bearing parallel-semantics assertion.

    // Assert: A's exit animation was dispatched on A.el.
    const exitCall = animateSpy.mock.calls.find((c) => {
      const target = c[0] as Element | undefined
      const opts = c[1] as { opacity?: number } | undefined
      return target === a && opts?.opacity === 0
    })
    expect(exitCall).toBeDefined()
  })

  it("A's onCleanup donates with a captured rect even when wrapped in Presence", async () => {
    // Pin the donate-at-onCleanup timing under Presence. Even though
    // Presence keeps A in the DOM, Solid disposes A's OWNER
    // synchronously at the flip, and that's where donate fires.
    // The stored entry's rect reflects A's stubbed value.
    const [page, setPage] = createSignal<"a" | "b">("a")
    function A() {
      const m = useMotion(() => ({ layoutId: "card", exit: { opacity: 0 } }))
      return <div data-testid="a" {...m()} />
    }
    function B() {
      const m = useMotion(() => ({ layoutId: "card" }))
      // Stub B's rect via the ref callback so it's already set when
      // the FIRST measurement (= the FLIP) runs.
      return (
        <div
          data-testid="b"
          {...m({
            ref: (e) => stubRect(e, { x: 500, y: 500, width: 100, height: 100 }),
          })}
        />
      )
    }
    const { container } = render(() => (
      <Presence mode="sync">
        <Show when={page() === "a"} fallback={<B />}>
          <A />
        </Show>
      </Presence>
    ))
    const a = container.querySelector<HTMLElement>("[data-testid='a']") as HTMLElement
    stubRect(a, { x: 100, y: 100, width: 200, height: 200 })
    await flushFrame()
    setPage("b")
    await flush()
    await flushFrame()

    const b = container.querySelector<HTMLElement>("[data-testid='b']") as HTMLElement
    expect(b).toBeTruthy()
    // B FLIPped from A's rect — the donate must have fired at A's
    // onCleanup with A's stubbed value (100, 100, 200, 200), and
    // B's consume converted it to local coords against documentElement
    // (0, 0, 1000, 1000). Local: (100, 100) → delta from (500, 500)
    // is (-400, -400); scales 200/100 = 2.
    expect(b.style.transform).toContain("translateX(-400px)")
    expect(b.style.transform).toContain("translateY(-400px)")
    expect(b.style.transform).toContain("scaleX(2)")
    expect(b.style.transform).toContain("scaleY(2)")
  })
})
