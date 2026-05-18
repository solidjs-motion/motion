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
// Press gesture tests (Q1/C, Q13/c — success/cancel branch)
//
// motion-dom's press: pointerdown on element → press start. pointerup on
// window → success (pointer still over element) or cancel (pointer moved
// away). pointercancel always = cancel.
//
// Test strategy A (Q14): fire real pointer events. fireEvent.pointerDown
// dispatches on element; pointerup/pointercancel dispatch on window.
// ---------------------------------------------------------------------------

describe("press gesture — state activation", () => {
  it("activates whilePress on pointerdown, animates to press target", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { scale: 1 }, press: { scale: 0.95 } })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    animateSpy.mockClear()

    fireEvent.pointerDown(el, { pointerId: 1, button: 0, isPrimary: true })

    expect(animateSpy).toHaveBeenCalled()
    const lastCall = animateSpy.mock.calls.at(-1)
    expect(lastCall?.[1]).toMatchObject({ scale: 0.95 })
    unmount()
  })

  it("deactivates whilePress on pointerup, falls scale back to animate's value", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { scale: 1 }, press: { scale: 0.95 } })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, isPrimary: true })
    animateSpy.mockClear()

    // pointerup fires on the element — motion-dom's window listener still
    // catches it via bubbling, and event.target stays as `el` so
    // isNodeOrChild(target, upEvent.target) returns true (success=true).
    fireEvent.pointerUp(el, { pointerId: 1, button: 0, isPrimary: true })

    expect(animateSpy).toHaveBeenCalled()
    const lastCall = animateSpy.mock.calls.at(-1)
    expect(lastCall?.[1]).toMatchObject({ scale: 1 })
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Callback pass-through and success / cancel branching (Q13/c)
// ---------------------------------------------------------------------------

describe("press gesture — callbacks", () => {
  it("fires onPressStart on pointerdown (no info arg per Q13c tightened signature)", () => {
    const onPressStart = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { scale: 1 }, press: { scale: 0.95 }, onPressStart })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerDown(el, { pointerId: 1, button: 0, isPrimary: true })

    expect(onPressStart).toHaveBeenCalledOnce()
    // Signature: (e: PointerEvent) => void. First and only arg is the event.
    expect(onPressStart.mock.calls[0]?.[0]).toBeInstanceOf(Event)
    expect(onPressStart.mock.calls[0]?.length).toBe(1)
    unmount()
  })

  it("fires onPress on successful pointerup (pointer still over element)", () => {
    const onPress = vi.fn()
    const onPressCancel = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({
        animate: { scale: 1 },
        press: { scale: 0.95 },
        onPress,
        onPressCancel,
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, isPrimary: true })

    // pointerup on `el` bubbles to window where motion-dom's listener lives;
    // event.target stays as `el`, so isNodeOrChild(el, el) returns true and
    // success=true is reported in the press end info.
    fireEvent.pointerUp(el, { pointerId: 1, button: 0, isPrimary: true })

    expect(onPress).toHaveBeenCalledOnce()
    expect(onPressCancel).not.toHaveBeenCalled()
    expect(onPress.mock.calls[0]?.[1]).toEqual({ success: true })
    unmount()
  })

  it("fires onPressCancel when pointerup target is outside the element", () => {
    const onPress = vi.fn()
    const onPressCancel = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({
        animate: { scale: 1 },
        press: { scale: 0.95 },
        onPress,
        onPressCancel,
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, isPrimary: true })

    // Fire pointerup on document.body — target is body, isNodeOrChild(el, body)
    // is false (body is not el or a descendant). motion-dom reports success=false.
    fireEvent.pointerUp(document.body, { pointerId: 1, button: 0, isPrimary: true })

    expect(onPressCancel).toHaveBeenCalledOnce()
    expect(onPress).not.toHaveBeenCalled()
    expect(onPressCancel.mock.calls[0]?.[1]).toEqual({ success: false })
    unmount()
  })

  it("fires onPressCancel via pointercancel (separate listener path from pointerup)", () => {
    // motion-dom registers TWO end listeners on window: pointerup (success
    // determined by target check) AND pointercancel (always success=false).
    // Both paths must deactivate the state and route to onPressCancel.
    const onPress = vi.fn()
    const onPressCancel = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({
        animate: { scale: 1 },
        press: { scale: 0.95 },
        onPress,
        onPressCancel,
      })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, isPrimary: true })
    animateSpy.mockClear()

    fireEvent.pointerCancel(el, { pointerId: 1, button: 0, isPrimary: true })

    expect(onPressCancel).toHaveBeenCalledOnce()
    expect(onPress).not.toHaveBeenCalled()
    expect(onPressCancel.mock.calls[0]?.[1]).toEqual({ success: false })

    // State machine must also deactivate whilePress — scale falls back to
    // animate's value of 1.
    const lastAnimate = animateSpy.mock.calls.at(-1)
    expect(lastAnimate?.[1]).toMatchObject({ scale: 1 })
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Secondary pointer / non-primary button — motion-dom filters via
// isValidPressEvent (button !== 0 and isPrimary === false are rejected).
// ---------------------------------------------------------------------------

describe("press gesture — pointer validity", () => {
  it("ignores non-primary mouse buttons (right-click etc.)", () => {
    const onPressStart = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { scale: 1 }, press: { scale: 0.95 }, onPressStart })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    animateSpy.mockClear()

    // isPrimaryPointer only applies the `button <= 0` filter for mouse
    // pointers. Explicit pointerType is required because jsdom's default is
    // an empty string, which would fall into the touch/pen branch.
    fireEvent.pointerDown(el, {
      pointerId: 1,
      button: 2,
      pointerType: "mouse",
      isPrimary: true,
    })

    expect(onPressStart).not.toHaveBeenCalled()
    expect(animateSpy).not.toHaveBeenCalled()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

describe("press gesture — cleanup", () => {
  it("removes the press listener on unmount", () => {
    const onPressStart = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { scale: 1 }, press: { scale: 0.95 }, onPressStart })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    unmount()

    fireEvent.pointerDown(el, { pointerId: 1, button: 0, isPrimary: true })
    expect(onPressStart).not.toHaveBeenCalled()
  })
})
