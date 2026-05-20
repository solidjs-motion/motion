// Stage 3 bridge tests — exercise the per-key dispatch routing decisions made
// by `getValueForAnimate` in createMotion.
//
// These tests assert on the *shape* of motion's `animate()` call: when
// bridging is inactive, animate gets called with `(el, target, opts)`. When
// active, transform-shortcut keys flow through MotionValues, so animate gets
// called with `(mv, value, opts)` per routed key. Non-transform keys stay on
// the WAA element-target path even when bridging is active (no `transform`
// string conflict to resolve).
//
// We don't assert that the actual tween animates a value, because animate is
// mocked. The mock returns a no-op thenable; the bridge mechanic is purely
// about how the dispatch is wired.

import { render } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// `vi.hoisted` runs at the same time `vi.mock` is hoisted so the factory
// can safely close over `animateSpy`. Without this we'd hit a TDZ error
// when motion is imported (anywhere — including the top-level `from "motion"`
// import below).
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

const { isMotionValue } = await import("motion")
const { useMotion } = await import("../src/use-motion")
const { createMotionValue } = await import("../src/primitives/motion-value")

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

const waitForEffects = async (): Promise<void> => {
  // Flush a couple microtask turns so Solid's createEffect dispatches its
  // diff-and-animate cycle before assertions run.
  for (let i = 0; i < 3; i++) await Promise.resolve()
}

describe("MV-in-style — Stage 3 bridge", () => {
  describe("bridge inactive (no style MV)", () => {
    it("dispatches animate(el, target, opts) for the whole target — regression-safe path", async () => {
      const { unmount } = render(() => {
        const m = useMotion({ animate: { x: 100, opacity: 0.5 } })
        return <div {...m()} />
      })
      await waitForEffects()

      const dispatchedToEl = animateSpy.mock.calls.find((c) => c[0] instanceof HTMLElement)
      expect(dispatchedToEl).toBeDefined()
      expect(dispatchedToEl?.[1]).toMatchObject({ x: 100, opacity: 0.5 })
      // No MV-targeted dispatches when bridging is inactive.
      const mvDispatches = animateSpy.mock.calls.filter((c) => isMotionValue(c[0]))
      expect(mvDispatches).toHaveLength(0)

      unmount()
    })
  })

  describe("bridge active (≥ 1 style MV)", () => {
    it("routes animate.{transform-key} through a transient MV", async () => {
      const opacity = createMotionValue(1)
      const { unmount } = render(() => {
        const m = useMotion({ animate: { x: 100 } })
        // opacity MV in style activates bridging; x is animated but has no
        // style MV — should get a transient MV from the registry.
        return (
          <div
            {...m({
              ref: (r) => {
                void r
              },
              style: { opacity: opacity as never },
            })}
          />
        )
      })
      await waitForEffects()

      // Find the animate call routed through a MotionValue (not the element).
      // Its target should be the scalar `100`, not an object.
      const routedX = animateSpy.mock.calls.find((c) => isMotionValue(c[0]) && c[1] === 100)
      expect(routedX).toBeDefined()
      expect(isMotionValue(routedX?.[0])).toBe(true)

      // The user's opacity MV is registered as external; animate is NOT
      // dispatched for it on first mount (no animate target for opacity).
      const opacityAnimate = animateSpy.mock.calls.find((c) => c[0] === opacity)
      expect(opacityAnimate).toBeUndefined()

      unmount()
    })

    it("routes animate.{same-key-as-style-MV} through the SAME external MV", async () => {
      const scale = createMotionValue(1)
      const { unmount } = render(() => {
        const m = useMotion({ animate: { scale: 1.5 } })
        return (
          <div
            {...m({
              ref: (r) => {
                void r
              },
              style: { scale: scale as never },
            })}
          />
        )
      })
      await waitForEffects()

      // The dispatch for scale should be against the user's external MV,
      // not a fresh transient. Target is the scalar 1.5.
      const scaleCall = animateSpy.mock.calls.find((c) => c[0] === scale)
      expect(scaleCall).toBeDefined()
      expect(scaleCall?.[1]).toBe(1.5)

      unmount()
    })

    it("keeps non-transform animate keys on the WAA element path", async () => {
      const scale = createMotionValue(1)
      const { unmount } = render(() => {
        const m = useMotion({ animate: { opacity: 0.2 } })
        return (
          <div
            {...m({
              ref: (r) => {
                void r
              },
              style: { scale: scale as never },
            })}
          />
        )
      })
      await waitForEffects()

      // opacity is non-transform AND has no external MV → falls through to
      // animate(el, { opacity: 0.2 }, opts). Not routed.
      const opacityCall = animateSpy.mock.calls.find((c) => c[0] instanceof HTMLElement)
      expect(opacityCall).toBeDefined()
      expect(opacityCall?.[1]).toMatchObject({ opacity: 0.2 })
      // Confirm scale (the external MV) was NOT animated for — animate target
      // doesn't include scale, so no MV dispatch either.
      const mvCalls = animateSpy.mock.calls.filter((c) => isMotionValue(c[0]))
      expect(mvCalls).toHaveLength(0)

      unmount()
    })

    it("splits dispatch across MV and WAA lanes for disjoint cooperation", async () => {
      const scale = createMotionValue(1)
      const { unmount } = render(() => {
        const m = useMotion({ animate: { y: 100, opacity: 0 } })
        // Mixed-key target: y is a transform shortcut → routes via transient,
        // opacity is non-transform → stays WAA. style.scale activates bridging.
        return (
          <div
            {...m({
              ref: (r) => {
                void r
              },
              style: { scale: scale as never },
            })}
          />
        )
      })
      await waitForEffects()

      // y dispatched through an MV (transient created), target is scalar 100.
      const yCall = animateSpy.mock.calls.find((c) => isMotionValue(c[0]) && c[1] === 100)
      expect(yCall).toBeDefined()

      // opacity dispatched through the element, target object has opacity only.
      const opacityCall = animateSpy.mock.calls.find((c) => c[0] instanceof HTMLElement)
      expect(opacityCall).toBeDefined()
      const opacityTarget = opacityCall?.[1] as Record<string, unknown> | undefined
      expect(opacityTarget?.opacity).toBe(0)
      // y is NOT in the element-target — it was routed away to the MV lane.
      expect(opacityTarget?.y).toBeUndefined()

      unmount()
    })
  })

  describe("hover gestures with bridge active", () => {
    it("hover dispatch routes transform keys through MVs but still hits animateSpy with hover values", async () => {
      const { fireEvent } = await import("@solidjs/testing-library")
      const scale = createMotionValue(1)
      let el!: HTMLDivElement
      const { unmount } = render(() => {
        const m = useMotion({
          animate: { x: 0 },
          hover: { x: 10 },
        })
        return (
          <div
            {...m({
              ref: (r) => {
                el = r as HTMLDivElement
              },
              style: { scale: scale as never },
            })}
          />
        )
      })
      await waitForEffects()
      animateSpy.mockClear()

      fireEvent.pointerEnter(el)
      await waitForEffects()

      // Hover's x=10 should route through an MV (bridge active because of
      // style.scale). Find an MV-targeted call with value 10.
      const hoverCall = animateSpy.mock.calls.find((c) => isMotionValue(c[0]) && c[1] === 10)
      expect(hoverCall).toBeDefined()

      // No element-targeted call for x — it should have been routed away.
      const elCallWithX = animateSpy.mock.calls.find((c) => {
        if (!(c[0] instanceof HTMLElement)) return false
        const t = c[1] as Record<string, unknown>
        return t && "x" in t
      })
      expect(elCallWithX).toBeUndefined()

      unmount()
    })
  })
})
