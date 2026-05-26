import { createRoot } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createGestureStateMachine } from "../../src/primitives/gesture-state"
import type { MotionOptions, Target } from "../../src/types"

// `vi.hoisted` lifts the spy creation alongside `vi.mock` (both run before
// any other top-level code). This lets us use static imports below; without
// hoisting, the mock factory would reference an uninitialized `animateSpy`
// from the TDZ. Phase 1's tests work around this with `await import(...)`
// instead — `vi.hoisted` is the cleaner equivalent.
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
// Test harness: spin up a state machine with minimal deps, return setActive.
// ---------------------------------------------------------------------------

function makeStateMachine(
  opts: MotionOptions | (() => MotionOptions),
  initialTarget: Target | null = null,
) {
  const el = document.createElement("div")
  const getOpts = typeof opts === "function" ? opts : () => opts
  let dispose: () => void = () => {}
  const machine = createRoot((d) => {
    dispose = d
    return createGestureStateMachine({
      el,
      getOpts,
      parentVariantCtx: {},
      motionConfig: {
        reducedMotion: () => "never",
        transition: () => undefined,
        nonce: () => undefined,
      },
      systemReducedMotion: () => false,
      initialTarget,
    })
  })
  return { ...machine, el, dispose }
}

// ---------------------------------------------------------------------------
// Phase 1 baseline preserved: animate target on construction
// ---------------------------------------------------------------------------

describe("gesture state machine — Phase 1 baseline", () => {
  it("animates to the animate target on first effect run", () => {
    const { dispose } = makeStateMachine({ animate: { x: 100, opacity: 1 } })
    expect(animateSpy).toHaveBeenCalledTimes(1)
    expect(animateSpy.mock.calls[0]?.[1]).toMatchObject({ x: 100, opacity: 1 })
    dispose()
  })

  it("skips animate when no animate target and no active gestures", () => {
    const { dispose } = makeStateMachine({})
    expect(animateSpy).not.toHaveBeenCalled()
    dispose()
  })

  it("honors initial:false by skipping the first animate", () => {
    const { dispose } = makeStateMachine({ initial: false, animate: { x: 50 } })
    expect(animateSpy).not.toHaveBeenCalled()
    dispose()
  })
})

// ---------------------------------------------------------------------------
// Priority resolution: high state's keys win over low state's keys
// ---------------------------------------------------------------------------

describe("gesture state machine — priority resolution", () => {
  it("hover keys win over animate keys when both are active", () => {
    const { setActive, dispose } = makeStateMachine({
      animate: { x: 0, opacity: 0.5 },
      hover: { x: 100 },
    })
    // After construction: only animate is active, full animate target applied.
    expect(animateSpy.mock.calls[0]?.[1]).toMatchObject({ x: 0, opacity: 0.5 })
    animateSpy.mockClear()

    // Activate whileHover: x switches to 100 (hover claim), opacity stays
    // animate-defined at 0.5 (but didn't change, so no diff for opacity).
    setActive("whileHover", true)
    expect(animateSpy).toHaveBeenCalledTimes(1)
    expect(animateSpy.mock.calls[0]?.[1]).toEqual({ x: 100 })
    dispose()
  })

  it("press wins over hover (higher priority)", () => {
    const { setActive, dispose } = makeStateMachine({
      animate: { x: 0 },
      hover: { x: 50 },
      press: { x: 100 },
    })
    animateSpy.mockClear()
    setActive("whileHover", true)
    setActive("whilePress", true)
    // Last call should reflect press winning x.
    const lastCall = animateSpy.mock.calls[animateSpy.mock.calls.length - 1]
    expect(lastCall?.[1]).toMatchObject({ x: 100 })
    dispose()
  })
})

// ---------------------------------------------------------------------------
// Per-key handoff (Q3b's defining feature): when a higher-priority state
// deactivates, keys it owned fall back to the next-defining state, or to
// the initial/default value.
// ---------------------------------------------------------------------------

describe("gesture state machine — per-key handoff (Q3b)", () => {
  it("falls keys back to the lower-priority defining state on deactivation", () => {
    const { setActive, dispose } = makeStateMachine({
      animate: { x: 0, opacity: 1 },
      hover: { x: 100, opacity: 0.5 },
    })
    animateSpy.mockClear()

    // Hover on: both keys switch to hover values.
    setActive("whileHover", true)
    const onCall = animateSpy.mock.calls[animateSpy.mock.calls.length - 1]
    expect(onCall?.[1]).toMatchObject({ x: 100, opacity: 0.5 })

    // Hover off: both keys fall back to animate (which defines both).
    setActive("whileHover", false)
    const offCall = animateSpy.mock.calls[animateSpy.mock.calls.length - 1]
    expect(offCall?.[1]).toMatchObject({ x: 0, opacity: 1 })
    dispose()
  })

  it("falls a key to motion default when no lower-priority state defines it (no initial)", () => {
    // hover defines scale; animate does not. On hover-off, scale should fall
    // back to motion default (1), NOT stay at the hover value.
    const { setActive, dispose } = makeStateMachine({
      animate: { x: 0 },
      hover: { x: 100, scale: 1.5 },
    })
    animateSpy.mockClear()

    setActive("whileHover", true)
    setActive("whileHover", false)

    // The last animate call should include scale → 1 (motion default for scale).
    const lastCall = animateSpy.mock.calls[animateSpy.mock.calls.length - 1]
    expect(lastCall?.[1]).toMatchObject({ scale: 1 })
    dispose()
  })

  it("falls a key to the user's initial when defined and no lower-priority state has it", () => {
    // initialTarget says opacity: 0. hover defines opacity: 1. animate doesn't.
    // On hover-off, opacity falls back to initial (0).
    const { setActive, dispose } = makeStateMachine(
      { animate: { x: 0 }, hover: { opacity: 1 } },
      { opacity: 0 },
    )
    animateSpy.mockClear()

    setActive("whileHover", true)
    setActive("whileHover", false)

    const lastCall = animateSpy.mock.calls[animateSpy.mock.calls.length - 1]
    expect(lastCall?.[1]).toMatchObject({ opacity: 0 })
    dispose()
  })

  it("falls a non-transform key to the captured pre-gesture computed value when no initial AND no motion default", () => {
    // background-color has no entry in TRANSFORM_DEFAULTS. With no initial
    // override, the originals map snapshots the element's computed style on
    // the first effect iteration (before any gesture has dispatched) and
    // serves THAT as the revert target. In jsdom, an unset background-color
    // computes to "rgba(0, 0, 0, 0)".
    const { setActive, dispose } = makeStateMachine({
      animate: { x: 0 },
      hover: { "background-color": "red" },
    })
    animateSpy.mockClear()

    setActive("whileHover", true)
    setActive("whileHover", false)

    const lastCall = animateSpy.mock.calls[animateSpy.mock.calls.length - 1]
    expect(lastCall?.[1]).toMatchObject({ "background-color": "rgba(0, 0, 0, 0)" })
    dispose()
  })

  it("skips the revert dispatch when the gesture value already equals the revert target", () => {
    // whileHover: { scale: 1 } sets scale to the motion default. The
    // first hover activation dispatches scale: 1 (vs lastApplied[scale]
    // = undefined). On hover-end, getRevertValue("scale") = 1 (motion
    // default) === lastApplied[scale] = 1 — the equality guard skips
    // the no-op animate() and the spurious prevControls.stop() that
    // would otherwise cancel any concurrent in-flight tween.
    const { setActive, dispose } = makeStateMachine({
      hover: { scale: 1 },
    })

    setActive("whileHover", true)
    const callsAfterActivate = animateSpy.mock.calls.length
    setActive("whileHover", false)
    const callsAfterDeactivate = animateSpy.mock.calls.length

    expect(callsAfterDeactivate).toBe(callsAfterActivate)
    dispose()
  })
})

// ---------------------------------------------------------------------------
// Reactive opts (Phase 1 invariant + Q3b reactivity)
// ---------------------------------------------------------------------------

describe("gesture state machine — reactive opts", () => {
  it("re-animates when opts.animate target changes via signal", async () => {
    const { createSignal } = await import("solid-js")
    const [x, setX] = createSignal(0)
    const { dispose } = makeStateMachine(() => ({ animate: { x: x() } }))

    // Initial run.
    expect(animateSpy).toHaveBeenCalledTimes(1)
    expect(animateSpy.mock.calls[0]?.[1]).toMatchObject({ x: 0 })

    // Signal change re-runs the effect with the new value.
    setX(200)
    const lastCall = animateSpy.mock.calls[animateSpy.mock.calls.length - 1]
    expect(lastCall?.[1]).toMatchObject({ x: 200 })
    dispose()
  })

  it("re-animates when a gesture state's target updates reactively mid-state", async () => {
    const { createSignal } = await import("solid-js")
    const [scale, setScale] = createSignal(1.1)
    const { setActive, dispose } = makeStateMachine(() => ({
      animate: { x: 0 },
      hover: { scale: scale() },
    }))
    animateSpy.mockClear()

    setActive("whileHover", true)
    expect(animateSpy.mock.calls[animateSpy.mock.calls.length - 1]?.[1]).toMatchObject({
      scale: 1.1,
    })

    // Hover is still active; the hover target's scale signal changes — the
    // state machine's stateTargets memo recomputes, winners changes, diff
    // effect fires animate with the new value.
    setScale(1.5)
    expect(animateSpy.mock.calls[animateSpy.mock.calls.length - 1]?.[1]).toMatchObject({
      scale: 1.5,
    })
    dispose()
  })
})

// ---------------------------------------------------------------------------
// No-`animate`-prop revert (regression — Phase 2's GestureComposition demo).
//
// When the user wires `initial` + gesture states without an `animate` prop,
// the bail-early at the top of the diff effect MUST still let the
// removed-key fallback run, otherwise gestures never visually revert.
// Caught a real-world bug: a button with `initial: { scale: 1 }`,
// `hover: { scale: 1.05 }`, no `animate` — once hovered, never returned.
// ---------------------------------------------------------------------------

describe("gesture state machine — revert without `animate` prop", () => {
  it("reverts hover keys to initial when only `initial` + `hover` are set (no `animate`)", () => {
    const { setActive, dispose } = makeStateMachine(
      { hover: { scale: 1.05, opacity: 0.9 } },
      // initialTarget — the construction-time-resolved initial. Provides the
      // fallback values when hover deactivates.
      { scale: 1, opacity: 1 },
    )
    animateSpy.mockClear()

    setActive("whileHover", true)
    const onCall = animateSpy.mock.calls.at(-1)
    expect(onCall?.[1]).toMatchObject({ scale: 1.05, opacity: 0.9 })

    // Hover off — both keys MUST animate back to their initial values.
    // Without the fix, the bail-early ("no winners AND no animate target")
    // returns before the removed-key loop, so the revert never fires.
    setActive("whileHover", false)
    const offCall = animateSpy.mock.calls.at(-1)
    expect(offCall?.[1]).toMatchObject({ scale: 1, opacity: 1 })
    dispose()
  })
})

// ---------------------------------------------------------------------------
// MotionValue-in-target subscriptions must SURVIVE a winners re-run that
// produces no diff (regression — Phase 2's SignalDrivenSize + ScrollLinked).
//
// Phase 2 wires createGestures unconditionally on every motion element. Its
// inView wiring fires `setActive("whileInView", ...)` once the browser's
// IntersectionObserver reports initial intersection — which invalidates the
// winners memo. With no `inView` target the winner *values* are unchanged,
// but the memo re-emits a new object reference and the diff-and-animate
// effect re-runs. Its iteration-scoped `onCleanup` unsubscribes the
// MV-on-change listeners BEFORE the new run, and if the new run early-
// returns ("no diff"), the listeners are never reattached.
// ---------------------------------------------------------------------------

describe("gesture state machine — MV subscriptions survive no-diff re-runs", () => {
  it("re-subscribes MV-on-change listeners when the effect re-runs with no value change", async () => {
    const { motionValue } = await import("motion")
    const size = motionValue(80)

    // Function-form options reading a signal. Updating the signal invalidates
    // the stateTargets memo (and therefore winners), forcing a fresh effect
    // run — exactly the pattern createGestures's inView wiring produces.
    const { createSignal } = await import("solid-js")
    const [tick, setTick] = createSignal(0)
    const { dispose } = makeStateMachine(() => {
      void tick()
      return { animate: { width: size, height: size } }
    })

    // Initial animate call uses MV snapshot.
    expect(animateSpy).toHaveBeenCalledTimes(1)
    expect(animateSpy.mock.calls[0]?.[1]).toMatchObject({ width: 80, height: 80 })
    animateSpy.mockClear()

    // Force a winners re-run that produces no diff (target values unchanged).
    setTick(1)

    // Now poke the MV. If the bug exists, the MV listener was unsubscribed
    // by the iteration-scoped onCleanup and never reattached — animate
    // won't fire. If the fix is in place, the listener survives.
    size.set(120)

    expect(animateSpy).toHaveBeenCalled()
    const widthCall = animateSpy.mock.calls.find((c) =>
      Object.keys(c[1] as object).includes("width"),
    )
    expect(widthCall?.[1]).toMatchObject({ width: 120 })
    dispose()
  })
})
