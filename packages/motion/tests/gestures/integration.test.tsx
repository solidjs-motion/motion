import { fireEvent, render } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

// ---------------------------------------------------------------------------
// Multi-gesture interaction tests.
//
// gesture-state.test.tsx exercises the priority chain through direct setActive
// calls. These tests exercise the same chain through *real DOM event sequences*
// — confirming the wiring from motion-dom listeners → setActive → state
// machine → animate() is end-to-end correct.
// ---------------------------------------------------------------------------

describe("press while hovering — priority chain through DOM events", () => {
  it("transitions through hover → press → hover → idle as events fire", () => {
    // Three layers of priority (low → high): animate < hover < press.
    // Each defines `scale` so we can watch per-key handoff in action.
    const { container, unmount } = render(() => {
      const m = useMotion({
        animate: { scale: 1 },
        hover: { scale: 1.1 },
        press: { scale: 0.95 },
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    animateSpy.mockClear()

    // 1. Hover begins — scale claimed by whileHover.
    fireEvent.pointerEnter(el)
    expect(animateSpy.mock.calls.at(-1)?.[1]).toMatchObject({ scale: 1.1 })

    // 2. Press begins while still hovering — press wins (higher priority).
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, isPrimary: true })
    expect(animateSpy.mock.calls.at(-1)?.[1]).toMatchObject({ scale: 0.95 })

    // 3. Press ends successfully — hover still active, scale falls BACK to
    //    hover's claim (1.1), not to animate's (1). This is the per-key
    //    handoff (Q3b) working through real events.
    fireEvent.pointerUp(el, { pointerId: 1, button: 0, isPrimary: true })
    expect(animateSpy.mock.calls.at(-1)?.[1]).toMatchObject({ scale: 1.1 })

    // 4. Pointer leaves — hover deactivates, scale falls back to animate's 1.
    fireEvent.pointerLeave(el)
    expect(animateSpy.mock.calls.at(-1)?.[1]).toMatchObject({ scale: 1 })
    unmount()
  })

  it("hover keys not overridden by press stay at hover values across the press cycle", () => {
    // press defines only `scale`. hover defines `scale` AND `opacity`.
    // When press activates, scale switches to 0.95 but opacity stays 0.8
    // (only hover defines it). When press ends, scale returns to 1.1.
    const { container, unmount } = render(() => {
      const m = useMotion({
        animate: { scale: 1, opacity: 1 },
        hover: { scale: 1.1, opacity: 0.8 },
        press: { scale: 0.95 },
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    animateSpy.mockClear()

    fireEvent.pointerEnter(el)
    // After hover: both keys claimed by whileHover.
    const afterHover = animateSpy.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(afterHover).toMatchObject({ scale: 1.1, opacity: 0.8 })

    animateSpy.mockClear()
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, isPrimary: true })
    // After press-down: only scale changes (press claims it). opacity
    // unchanged from hover's 0.8 — diff effect skips unchanged keys.
    const afterPress = animateSpy.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(afterPress).toMatchObject({ scale: 0.95 })
    expect(afterPress.opacity).toBeUndefined() // no diff for opacity

    unmount()
  })
})
