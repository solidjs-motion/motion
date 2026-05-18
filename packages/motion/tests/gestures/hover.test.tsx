import { fireEvent, render } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// `vi.hoisted` lifts the spy creation alongside `vi.mock` so static imports
// can resolve to the mocked module. Same pattern as gesture-state.test.tsx.
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
// Hover gesture tests (Q1/C — motion-dom's `hover` + state-machine setActive)
//
// Test strategy A (Q14): real motion-dom listeners + real DOM events via
// fireEvent. We mock motion's `animate` (Phase 1 pattern) so the state
// machine's animate call is captured as a spy.
// ---------------------------------------------------------------------------

describe("hover gesture — state activation", () => {
  it("activates whileHover on pointerenter, animates to hover target", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { x: 0 }, hover: { x: 100 } })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    animateSpy.mockClear()

    fireEvent.pointerEnter(el)

    // The state machine's diff-and-animate effect fires animate with the
    // hover target's claim on x. (Initial animate call from construction
    // was cleared above.)
    expect(animateSpy).toHaveBeenCalled()
    const lastCall = animateSpy.mock.calls.at(-1)
    expect(lastCall?.[1]).toMatchObject({ x: 100 })
    unmount()
  })

  it("deactivates whileHover on pointerleave, falls x back to animate's value", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { x: 0 }, hover: { x: 100 } })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    fireEvent.pointerEnter(el)
    animateSpy.mockClear()

    fireEvent.pointerLeave(el)

    // Per-key handoff: x falls back to animate's value of 0.
    expect(animateSpy).toHaveBeenCalled()
    const lastCall = animateSpy.mock.calls.at(-1)
    expect(lastCall?.[1]).toMatchObject({ x: 0 })
    unmount()
  })

  it("falls hover-only keys to motion defaults on pointerleave", () => {
    // scale only defined on hover. On pointerleave, scale should animate
    // back to the motion default (1) via Q7's fallback chain.
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { x: 0 }, hover: { scale: 1.1 } })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    fireEvent.pointerEnter(el)
    animateSpy.mockClear()

    fireEvent.pointerLeave(el)

    const lastCall = animateSpy.mock.calls.at(-1)
    expect(lastCall?.[1]).toMatchObject({ scale: 1 })
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Callback pass-through (Q13/b)
// ---------------------------------------------------------------------------

describe("hover gesture — callback pass-through", () => {
  it("fires onHoverStart with the pointer event on pointerenter", () => {
    const onHoverStart = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { x: 0 }, hover: { x: 100 }, onHoverStart })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerEnter(el)

    expect(onHoverStart).toHaveBeenCalledOnce()
    expect(onHoverStart.mock.calls[0]?.[0]).toBeInstanceOf(Event)
    unmount()
  })

  it("fires onHoverEnd on pointerleave", () => {
    const onHoverEnd = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { x: 0 }, hover: { x: 100 }, onHoverEnd })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    fireEvent.pointerEnter(el)

    fireEvent.pointerLeave(el)

    expect(onHoverEnd).toHaveBeenCalledOnce()
    unmount()
  })

  it("works without callbacks defined (only state machine, no errors)", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { x: 0 }, hover: { x: 100 } })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    // Should not throw on either event.
    expect(() => {
      fireEvent.pointerEnter(el)
      fireEvent.pointerLeave(el)
    }).not.toThrow()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Reactive opts (Q3b inherited)
// ---------------------------------------------------------------------------

describe("hover gesture — reactivity", () => {
  it("re-animates with the new hover target when opts.hover changes mid-hover", () => {
    const [scale, setScale] = createSignal(1.1)
    const { container, unmount } = render(() => {
      const m = useMotion(() => ({ animate: { x: 0 }, hover: { scale: scale() } }))
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement

    fireEvent.pointerEnter(el)
    expect(animateSpy.mock.calls.at(-1)?.[1]).toMatchObject({ scale: 1.1 })

    setScale(1.5)
    expect(animateSpy.mock.calls.at(-1)?.[1]).toMatchObject({ scale: 1.5 })
    unmount()
  })

  it("listener stays attached even when opts.hover is initially undefined", () => {
    // Q13/a: always-attach. If opts.hover is undefined, the listener still
    // fires; the state machine produces an empty diff for whileHover (no
    // target → no contribution to winners). No animate call should result.
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { x: 0 } })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    animateSpy.mockClear()

    fireEvent.pointerEnter(el)
    fireEvent.pointerLeave(el)

    // No animate calls because whileHover has no target to contribute.
    expect(animateSpy).not.toHaveBeenCalled()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Cleanup (motion-dom's hover() returns a void function we register via onCleanup)
// ---------------------------------------------------------------------------

describe("hover gesture — cleanup", () => {
  it("removes the hover listener on unmount (no animate after unmount)", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { x: 0 }, hover: { x: 100 } })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    unmount()
    animateSpy.mockClear()

    // After unmount, motion-dom's listener should be removed. Dispatching
    // pointerenter shouldn't trigger the state machine.
    fireEvent.pointerEnter(el)
    expect(animateSpy).not.toHaveBeenCalled()
  })
})
