import { render } from "@solidjs/testing-library"
import { createRoot, createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Spy on motion's animate before importing anything that uses it. The variadic
// `args` signature lets mock.calls index past position 0 without TS narrowing
// the tuple to length 0.
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

// After mock setup, import the modules under test.
const { useMotion } = await import("../src/use-motion")
const { createMotion } = await import("../src/primitives/createMotion")
const { MotionConfig } = await import("../src/motion-config")
const { PresenceContext } = await import("../src/presence-context")

beforeEach(() => {
  animateSpy.mockClear()
  // Stub matchMedia so createReducedMotion doesn't error when createMotion
  // pulls it in via the MotionConfig path.
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
// useMotion getter shape & prop merging (Q2)
// ---------------------------------------------------------------------------

describe("useMotion — getter shape", () => {
  it("returns a callable function with a Provider component attached", () => {
    createRoot((dispose) => {
      const m = useMotion({ initial: { opacity: 0 } })
      expect(typeof m).toBe("function")
      expect(typeof m.Provider).toBe("function")
      dispose()
    })
  })

  it("emits the initial style with data-motion-hydrated marker", () => {
    createRoot((dispose) => {
      const m = useMotion({ initial: { opacity: 0, y: 20 } })
      const props = m()
      expect(props.style).toEqual({ opacity: 0, transform: "translateY(20px)" })
      expect(props["data-motion-hydrated"]).toBe("")
      dispose()
    })
  })

  it("omits data-motion-hydrated when initial:false", () => {
    createRoot((dispose) => {
      const m = useMotion({ initial: false, animate: { opacity: 1 } })
      const props = m()
      expect(props.style).toEqual({})
      expect(props["data-motion-hydrated"]).toBeUndefined()
      dispose()
    })
  })

  it("derives initial style from `animate` when `initial` is not given", () => {
    createRoot((dispose) => {
      const m = useMotion({ animate: { opacity: 0.5, x: 10 } })
      const props = m()
      expect(props.style).toEqual({ opacity: 0.5, transform: "translateX(10px)" })
      dispose()
    })
  })
})

describe("useMotion — style precedence (Q2 sub-1: motion wins)", () => {
  it("motion's initial style overrides user's style for conflicting keys", () => {
    createRoot((dispose) => {
      const m = useMotion({ initial: { opacity: 0 } })
      const props = m({ style: { opacity: 0.5, padding: "1rem" } })
      // Motion's opacity wins; user's padding passes through.
      expect(props.style).toEqual({ opacity: 0, padding: "1rem" })
      dispose()
    })
  })

  it("preserves user style keys that don't conflict with motion", () => {
    createRoot((dispose) => {
      const m = useMotion({ initial: { x: 10 } })
      const props = m({ style: { color: "red", padding: "2rem" } })
      expect(props.style).toMatchObject({
        color: "red",
        padding: "2rem",
        transform: "translateX(10px)",
      })
      dispose()
    })
  })
})

describe("useMotion — ref composition (Q2 sub-2)", () => {
  it("calls both the user's ref and motion's ref on mount", () => {
    const userRef = vi.fn()
    const { container, unmount } = render(() => {
      const m = useMotion({ initial: { opacity: 0 } })
      return <div {...m({ ref: userRef })}>x</div>
    })
    const el = container.firstChild as HTMLElement
    // mergeRefs may pass additional args to user refs; assert on the first arg only.
    expect(userRef).toHaveBeenCalled()
    expect(userRef.mock.calls[0]?.[0]).toBe(el)
    unmount()
  })

  it("passes the same element to user ref and motion's createMotion", () => {
    // Phase 4 widened the ref type to HTMLElement | SVGElement (so motion.svg
    // works). The runtime element in this test is still a div, but the
    // captured type has to match the wider callback signature.
    let userRefArg: HTMLElement | SVGElement | undefined
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { x: 100 } })
      return <div {...m({ ref: (el) => (userRefArg = el) })}>x</div>
    })
    expect(userRefArg).toBe(container.firstChild)
    expect(animateSpy).toHaveBeenCalled()
    const [el] = animateSpy.mock.calls[0]!
    expect(el).toBe(container.firstChild)
    unmount()
  })
})

describe("useMotion — multi-useMotion stacking (Q2 sub-3)", () => {
  it("composes two useMotion calls; both styles merge with later-call winning", () => {
    createRoot((dispose) => {
      const fade = useMotion({ initial: { opacity: 0 } })
      const slide = useMotion({ initial: { y: 20 } })
      // Outer wraps inner: fade(slide(userProps))
      const props = fade(slide({ class: "card" }))
      // Last write wins for conflicting keys; both targets land in style.
      expect(props.style).toMatchObject({
        opacity: 0,
        transform: "translateY(20px)",
      })
      expect((props as { class: string }).class).toBe("card")
      dispose()
    })
  })
})

// ---------------------------------------------------------------------------
// Reactive form (Q6 sub-1: whole-target effect)
// ---------------------------------------------------------------------------

describe("createMotion — reactive form", () => {
  it("calls animate with the resolved target on first effect tick", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ animate: { x: 50, opacity: 0.5 } })
      return <div {...m()} />
    })
    expect(animateSpy).toHaveBeenCalled()
    const [el, target] = animateSpy.mock.calls[0]!
    expect(el).toBe(container.firstChild)
    expect(target).toMatchObject({ x: 50, opacity: 0.5 })
    unmount()
  })

  it("re-fires animate when a tracked signal in the reactive form changes", async () => {
    const [x, setX] = createSignal(0)
    const { unmount } = render(() => {
      const m = useMotion(() => ({ animate: { x: x() } }))
      return <div {...m()} />
    })
    // Initial call
    expect(animateSpy).toHaveBeenCalledTimes(1)
    setX(100)
    // Solid effects flush on next microtask
    await Promise.resolve()
    expect(animateSpy).toHaveBeenCalledTimes(2)
    expect(animateSpy.mock.calls[1]?.[1]).toMatchObject({ x: 100 })
    unmount()
  })

  it("re-fires animate when a MotionValue in target changes (createMotion subscribes via mv.on)", async () => {
    // Use the real motion package's motionValue here — vi.mock only replaces
    // animate, not motionValue.
    const { motionValue } = await import("motion")
    const size = motionValue(80)
    const { unmount } = render(() => {
      const m = useMotion({ animate: { width: size } })
      return <div {...m()} />
    })
    // Initial call uses the MV's current snapshot.
    expect(animateSpy).toHaveBeenCalledTimes(1)
    expect(animateSpy.mock.calls[0]?.[1]).toMatchObject({ width: 80 })

    // Imperative MV update should trigger a per-property re-animate. The
    // createEffect doesn't track motion values; the mv.on("change", ...)
    // subscription set up by createMotion is what re-fires animate here.
    size.set(120)
    expect(animateSpy).toHaveBeenCalledTimes(2)
    expect(animateSpy.mock.calls[1]?.[1]).toMatchObject({ width: 120 })

    size.set(160)
    expect(animateSpy).toHaveBeenCalledTimes(3)
    expect(animateSpy.mock.calls[2]?.[1]).toMatchObject({ width: 160 })
    unmount()
  })

  it("re-fires animate when a createMotionValue (Proxy hybrid) in target changes", async () => {
    // Same coverage as the prior test, but using the callable-hybrid
    // factory rather than raw motionValue(). Validates that isMotionValue's
    // duck-typed `.getVelocity` check passes through the Proxy and that the
    // change-subscription path remains wired when the MV reference is a
    // Proxy (the basic example's SignalDrivenSize demo exercises this).
    const { createMotionValue } = await import("../src/primitives/motion-value")
    let size!: ReturnType<typeof createMotionValue<number>>
    const { unmount } = render(() => {
      size = createMotionValue(80)
      const m = useMotion({ animate: { width: size, height: size } })
      return <div {...m()} />
    })
    expect(animateSpy).toHaveBeenCalledTimes(1)
    expect(animateSpy.mock.calls[0]?.[1]).toMatchObject({ width: 80, height: 80 })

    size.set(120)
    // Two re-fires: once for width's change-subscription, once for height's.
    expect(animateSpy).toHaveBeenCalledTimes(3)
    const widthCall = animateSpy.mock.calls
      .slice(1)
      .find((c) => Object.keys(c[1] as object).includes("width"))
    const heightCall = animateSpy.mock.calls
      .slice(1)
      .find((c) => Object.keys(c[1] as object).includes("height"))
    expect(widthCall?.[1]).toMatchObject({ width: 120 })
    expect(heightCall?.[1]).toMatchObject({ height: 120 })
    unmount()
  })
})

// ---------------------------------------------------------------------------
// initial:false guard (Q6 sub-3)
// ---------------------------------------------------------------------------

describe("createMotion — initial:false first-run guard", () => {
  it("skips the first animate call when initial is false", () => {
    const { unmount } = render(() => {
      const m = useMotion({ initial: false, animate: { x: 100 } })
      return <div {...m()} />
    })
    // First run is skipped; the createEffect doesn't fire animate.
    expect(animateSpy).not.toHaveBeenCalled()
    unmount()
  })

  it("fires animate on subsequent signal-driven runs after initial:false skip", async () => {
    const [x, setX] = createSignal(0)
    const { unmount } = render(() => {
      const m = useMotion(() => ({ initial: false, animate: { x: x() } }))
      return <div {...m()} />
    })
    expect(animateSpy).not.toHaveBeenCalled()
    setX(50)
    await Promise.resolve()
    expect(animateSpy).toHaveBeenCalledTimes(1)
    unmount()
  })
})

// ---------------------------------------------------------------------------
// SSR hydration marker (Q1.4 + Q6 sub-7)
// ---------------------------------------------------------------------------

describe("createMotion — SSR hydration handoff", () => {
  it("skips initial style application when initialAppliedBySSR is true", () => {
    // Real DOM element required: Phase 2's createGestures attaches motion-dom
    // hover/press/focus listeners on the element via addEventListener. The
    // assertion is unchanged — when initialAppliedBySSR is true, the inline
    // style is NOT written by createMotion (SSR already emitted it).
    const el = document.createElement("div")
    createRoot((dispose) => {
      createMotion(el, () => ({ initial: { opacity: 0 } }), { initialAppliedBySSR: true })
      expect(el.style.opacity).toBe("")
      dispose()
    })
  })

  it("applies the initial style synchronously when no SSR marker (pre-paint)", () => {
    const { container, unmount } = render(() => {
      const m = useMotion({ initial: { opacity: 0, x: 50 } })
      return <div {...m()} />
    })
    const el = container.firstChild as HTMLElement
    // The ref ran createMotion, which applied the initial style inline.
    expect(el.style.opacity).toBe("0")
    expect(el.style.transform).toBe("translateX(50px)")
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Variant resolution (Q4)
// ---------------------------------------------------------------------------

describe("createMotion — variant resolution", () => {
  it("resolves animate=variant-name through own variants", () => {
    const { unmount } = render(() => {
      const m = useMotion({
        animate: "visible",
        variants: { visible: { opacity: 1, x: 0 }, hidden: { opacity: 0, x: 100 } },
      })
      return <div {...m()} />
    })
    expect(animateSpy).toHaveBeenCalled()
    expect(animateSpy.mock.calls[0]?.[1]).toMatchObject({ opacity: 1, x: 0 })
    unmount()
  })

  it("does not animate when variant name is unknown to own variants", () => {
    const { unmount } = render(() => {
      const m = useMotion({ animate: "nonexistent", variants: { visible: { opacity: 1 } } })
      return <div {...m()} />
    })
    expect(animateSpy).not.toHaveBeenCalled()
    unmount()
  })

  it("inherits parent variant name via m.Provider but resolves in own variants (Q4 sub-2 + Pattern X)", () => {
    const Parent = (props: { children: import("solid-js").JSX.Element }) => {
      const m = useMotion({
        animate: "visible",
        variants: { visible: { opacity: 1 } },
      })
      return (
        <div {...m()}>
          <m.Provider>{props.children}</m.Provider>
        </div>
      )
    }
    const Child = () => {
      const m = useMotion({
        variants: { visible: { x: 30 } }, // own definition of "visible"
      })
      return <div {...m()} data-testid="child" />
    }
    render(() => (
      <Parent>
        <Child />
      </Parent>
    ))
    // Parent's animate call (visible=opacity:1) and child's (visible=x:30 via inherited name).
    const childCall = animateSpy.mock.calls.find(
      ([, target]) => (target as Record<string, unknown>).x === 30,
    )
    expect(childCall).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Lifecycle hooks (Q9)
// ---------------------------------------------------------------------------

describe("createMotion — lifecycle callbacks", () => {
  it("wires onAnimationStart/Complete/Cancel/Update into motion's animate options", () => {
    const onAnimationStart = vi.fn()
    const onAnimationComplete = vi.fn()
    const onAnimationCancel = vi.fn()
    const onUpdate = vi.fn()
    const { unmount } = render(() => {
      const m = useMotion({
        animate: { x: 50 },
        onAnimationStart,
        onAnimationComplete,
        onAnimationCancel,
        onUpdate,
      })
      return <div {...m()} />
    })
    const passedOpts = animateSpy.mock.calls[0]?.[2] as Record<string, unknown>
    // Motion's option keys are onPlay/onComplete/onStop/onUpdate; we adapt names.
    expect(typeof passedOpts.onPlay).toBe("function")
    expect(typeof passedOpts.onComplete).toBe("function")
    expect(typeof passedOpts.onStop).toBe("function")
    expect(typeof passedOpts.onUpdate).toBe("function")

    // Invoking the wired callbacks should trigger our hooks.
    ;(passedOpts.onPlay as () => void)()
    expect(onAnimationStart).toHaveBeenCalled()
    ;(passedOpts.onComplete as () => void)()
    expect(onAnimationComplete).toHaveBeenCalledWith({ x: 50 })
    ;(passedOpts.onStop as () => void)()
    expect(onAnimationCancel).toHaveBeenCalled()
    ;(passedOpts.onUpdate as (v: unknown) => void)({ x: 25 })
    expect(onUpdate).toHaveBeenCalledWith({ x: 25 })
    unmount()
  })

  it("omits lifecycle options when no user callbacks provided", () => {
    const { unmount } = render(() => {
      const m = useMotion({ animate: { x: 50 } })
      return <div {...m()} />
    })
    const passedOpts = animateSpy.mock.calls[0]?.[2] as Record<string, unknown>
    expect(passedOpts.onPlay).toBeUndefined()
    expect(passedOpts.onComplete).toBeUndefined()
    expect(passedOpts.onStop).toBeUndefined()
    expect(passedOpts.onUpdate).toBeUndefined()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// MotionConfig reduced-motion (Q11 sub-4)
// ---------------------------------------------------------------------------

describe("createMotion — reduced motion", () => {
  it("collapses transition to { duration: 0 } when MotionConfig reducedMotion is 'always'", () => {
    const { unmount } = render(() => (
      <MotionConfig reducedMotion="always">
        {(() => {
          const m = useMotion({ animate: { x: 50 }, transition: { duration: 0.5 } })
          return <div {...m()} />
        })()}
      </MotionConfig>
    ))
    const passedOpts = animateSpy.mock.calls[0]?.[2] as Record<string, unknown>
    expect(passedOpts.duration).toBe(0)
    unmount()
  })

  it("respects user transition when reducedMotion is 'never' (default)", () => {
    const { unmount } = render(() => {
      const m = useMotion({ animate: { x: 50 }, transition: { duration: 0.5 } })
      return <div {...m()} />
    })
    const passedOpts = animateSpy.mock.calls[0]?.[2] as Record<string, unknown>
    expect(passedOpts.duration).toBe(0.5)
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Presence wiring (Q8)
// ---------------------------------------------------------------------------

describe("createMotion — presence wiring", () => {
  it("calls register on mount when exit is defined", () => {
    const register = vi.fn()
    const unregister = vi.fn()
    const beforeUnmount = vi.fn(() => Promise.resolve())
    const { unmount } = render(() => (
      <PresenceContext.Provider value={{ register, unregister, beforeUnmount }}>
        {(() => {
          const m = useMotion({ animate: { x: 0 }, exit: { x: 100 } })
          return <div {...m()} />
        })()}
      </PresenceContext.Provider>
    ))
    expect(register).toHaveBeenCalledOnce()
    const [el, exitTarget] = register.mock.calls[0]!
    expect(el).toBeInstanceOf(HTMLElement)
    expect(exitTarget).toEqual({ x: 100 })
    unmount()
    expect(unregister).toHaveBeenCalledOnce()
  })

  it("does not call register when exit is undefined", () => {
    const register = vi.fn()
    const { unmount } = render(() => (
      <PresenceContext.Provider
        value={{
          register,
          unregister: vi.fn(),
          beforeUnmount: () => Promise.resolve(),
        }}
      >
        {(() => {
          const m = useMotion({ animate: { x: 0 } })
          return <div {...m()} />
        })()}
      </PresenceContext.Provider>
    ))
    expect(register).not.toHaveBeenCalled()
    unmount()
  })
})
