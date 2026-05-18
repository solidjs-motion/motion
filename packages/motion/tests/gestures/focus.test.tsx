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
// Focus gesture tests (Q12 — focus-visible gating for state, callbacks
// always fire).
//
// jsdom's :focus-visible returns true when el.focus() is called
// programmatically — perfect for testing the activation path. Mouse-click
// focus that doesn't trigger :focus-visible is not easily simulated in
// jsdom (the browser's heuristic isn't fully implemented), but the
// fallback path (matches() throwing) is covered by mocking.
// ---------------------------------------------------------------------------

describe("focus gesture — state activation", () => {
  it("activates whileFocus when focus matches :focus-visible (programmatic focus)", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { opacity: 1 }, focus: { opacity: 0.5 } })
      return <button {...m()} type="button" />
    })
    const el = container.firstChild as HTMLButtonElement
    animateSpy.mockClear()

    // Programmatic focus in jsdom triggers :focus-visible to match.
    el.focus()
    fireEvent.focus(el)

    expect(animateSpy).toHaveBeenCalled()
    expect(animateSpy.mock.calls.at(-1)?.[1]).toMatchObject({ opacity: 0.5 })
    unmount()
  })

  it("deactivates whileFocus on blur, falls opacity back to animate's value", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { opacity: 1 }, focus: { opacity: 0.5 } })
      return <button {...m()} type="button" />
    })
    const el = container.firstChild as HTMLButtonElement
    el.focus()
    fireEvent.focus(el)
    animateSpy.mockClear()

    el.blur()
    fireEvent.blur(el)

    expect(animateSpy).toHaveBeenCalled()
    expect(animateSpy.mock.calls.at(-1)?.[1]).toMatchObject({ opacity: 1 })
    unmount()
  })

  it("does NOT activate whileFocus when :focus-visible does not match", () => {
    // Stub el.matches to return false for :focus-visible — simulates a
    // mouse-click focus that the browser deems non-keyboard.
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { opacity: 1 }, focus: { opacity: 0.5 } })
      return <button {...m()} type="button" />
    })
    const el = container.firstChild as HTMLButtonElement
    // Cast the vi.fn() return to typeof el.matches — the real matches
    // signature has overloaded type-predicate forms that vi.fn can't
    // reproduce structurally. We only care about the boolean-returning case.
    const originalMatches = el.matches.bind(el)
    el.matches = vi.fn((selector: string) => {
      if (selector === ":focus-visible") return false
      return originalMatches(selector)
    }) as unknown as typeof el.matches
    animateSpy.mockClear()

    fireEvent.focus(el)

    // No animate call because whileFocus has no target contribution.
    expect(animateSpy).not.toHaveBeenCalled()
    unmount()
  })

  it("falls back to always-active when :focus-visible throws (older browsers)", () => {
    // The try/catch around el.matches(":focus-visible") returns true when
    // the selector is unsupported. Simulates IE-style browsers.
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { opacity: 1 }, focus: { opacity: 0.5 } })
      return <button {...m()} type="button" />
    })
    const el = container.firstChild as HTMLButtonElement
    el.matches = vi.fn(() => {
      throw new Error("unsupported selector")
    }) as unknown as typeof el.matches
    animateSpy.mockClear()

    fireEvent.focus(el)

    // Fallback path: treat as focus-visible, activate whileFocus.
    expect(animateSpy).toHaveBeenCalled()
    expect(animateSpy.mock.calls.at(-1)?.[1]).toMatchObject({ opacity: 0.5 })
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Callback pass-through (Q12b — callbacks fire on ALL focus/blur events,
// not gated by :focus-visible)
// ---------------------------------------------------------------------------

describe("focus gesture — callbacks", () => {
  it("fires onFocus on focus regardless of :focus-visible match", () => {
    const onFocus = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { opacity: 1 }, focus: { opacity: 0.5 }, onFocus })
      return <button {...m()} type="button" />
    })
    const el = container.firstChild as HTMLButtonElement
    // Stub matches to return false — focus-visible doesn't match, but
    // onFocus should still fire (callbacks aren't gated by it).
    const originalMatches = el.matches.bind(el)
    el.matches = vi.fn((selector: string) => {
      if (selector === ":focus-visible") return false
      return originalMatches(selector)
    }) as unknown as typeof el.matches

    fireEvent.focus(el)

    expect(onFocus).toHaveBeenCalledOnce()
    expect(onFocus.mock.calls[0]?.[0]).toBeInstanceOf(Event)
    unmount()
  })

  it("fires onBlur on blur", () => {
    const onBlur = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { opacity: 1 }, focus: { opacity: 0.5 }, onBlur })
      return <button {...m()} type="button" />
    })
    const el = container.firstChild as HTMLButtonElement
    fireEvent.focus(el)

    fireEvent.blur(el)

    expect(onBlur).toHaveBeenCalledOnce()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

describe("focus gesture — cleanup", () => {
  it("removes focus and blur listeners on unmount", () => {
    const onFocus = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { opacity: 1 }, focus: { opacity: 0.5 }, onFocus })
      return <button {...m()} type="button" />
    })
    const el = container.firstChild as HTMLButtonElement
    unmount()

    fireEvent.focus(el)
    expect(onFocus).not.toHaveBeenCalled()
  })
})
