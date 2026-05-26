import { fireEvent, render } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Originals tracking — pre-gesture computed-style capture for non-transform
// CSS properties. When a gesture deactivates and animate doesn't claim the
// key, the removed-key fallback chain now walks:
//   own initial → motion default (if any) → captured original → null
//
// The originals branch is what makes `whileHover: { "box-shadow": "..." }`
// revert cleanly on pointerleave without the user having to add a redundant
// `animate: { "box-shadow": "..." }` clause. Before this, the fallback
// returned `null` and motion's animate() treated it as a no-op (computed
// style at revert-dispatch time already showed the gesture target).
// ---------------------------------------------------------------------------

const { animateSpy } = vi.hoisted(() => ({
  animateSpy: vi.fn((..._args: unknown[]) => ({
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
  })),
}))

vi.mock("motion", async () => {
  const actual = await vi.importActual<typeof import("motion")>("motion")
  return { ...actual, animate: animateSpy }
})

const { useMotion } = await import("../../src/use-motion")

beforeEach(() => {
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
  delete (window as Partial<Window>).matchMedia
})

describe("originals tracking — non-transform property reverts", () => {
  it("reverts box-shadow to a normalized zero-shadow when there's no initial/animate value", () => {
    // The element has no inline shadow and no CSS-applied shadow, so its
    // computed box-shadow is "" (jsdom) or "none" (real browser). The
    // originals normalizer canonicalizes both to a transparent zero-shadow
    // that shares its component shape with the gesture value — so WAA can
    // interpolate the revert smoothly.
    const { container, unmount } = render(() => {
      const m = useMotion({ hover: { "box-shadow": "0px 6px 18px rgba(0,0,0,0.25)" } })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerEnter(el)
    animateSpy.mockClear()
    fireEvent.pointerLeave(el)

    const revertCall = animateSpy.mock.calls.at(-1)
    expect(revertCall?.[1]).toMatchObject({
      "box-shadow": "0px 0px 0px rgba(0,0,0,0)",
    })
    unmount()
  })

  it("reverts background-color to the captured computed value (jsdom default: transparent)", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ hover: { "background-color": "red" } })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerEnter(el)
    animateSpy.mockClear()
    fireEvent.pointerLeave(el)

    const revertCall = animateSpy.mock.calls.at(-1)
    expect(revertCall?.[1]).toMatchObject({
      "background-color": "rgba(0, 0, 0, 0)",
    })
    unmount()
  })

  it("captures the element's inline style as the original when one is set", () => {
    // Inline style on the rendered element should propagate through to the
    // captured original. The revert lands on THAT, not on the jsdom default.
    const { container, unmount } = render(() => {
      const m = useMotion({ hover: { "background-color": "red" } })
      return <div {...m()} style={{ "background-color": "rgb(0, 128, 0)" }} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerEnter(el)
    animateSpy.mockClear()
    fireEvent.pointerLeave(el)

    const revertCall = animateSpy.mock.calls.at(-1)
    expect(revertCall?.[1]).toMatchObject({
      "background-color": "rgb(0, 128, 0)",
    })
    unmount()
  })

  it("initial wins over originals when both define a key", () => {
    // Explicit initial is the highest-priority entry in the revert chain.
    // The captured original (a transparent color) is shadowed by initial's
    // "blue".
    const { container, unmount } = render(() => {
      const m = useMotion({
        initial: { "background-color": "blue" },
        hover: { "background-color": "red" },
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerEnter(el)
    animateSpy.mockClear()
    fireEvent.pointerLeave(el)

    const revertCall = animateSpy.mock.calls.at(-1)
    expect(revertCall?.[1]).toMatchObject({ "background-color": "blue" })
    unmount()
  })

  it("transform keys keep using the motion default (originals do NOT apply)", () => {
    // scale's computed-style read would give "matrix(...)" — useless for
    // animation. The chain prefers the canonical motion default (1) over
    // any computed-style snapshot for keys present in TRANSFORM_DEFAULTS.
    const { container, unmount } = render(() => {
      const m = useMotion({ hover: { scale: 1.5 } })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerEnter(el)
    animateSpy.mockClear()
    fireEvent.pointerLeave(el)

    const revertCall = animateSpy.mock.calls.at(-1)
    expect(revertCall?.[1]).toMatchObject({ scale: 1 })
    unmount()
  })
})
