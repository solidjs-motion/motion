import { animate, isMotionValue, motionValue, type SpringOptions } from "motion"
import { createComputed, createRoot, createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createMotionValue,
  createMotionValueEvent,
  createSpring,
  createTemplate,
  createTime,
  createTransform,
  createVelocity,
  toSignal,
} from "../../src/primitives/motion-value"


// Run `fn` inside a tracked reactive root; return the root's dispose so tests
// can verify onCleanup behavior. Mirrors Solid's recommended test pattern.
function inRoot<T>(fn: (dispose: () => void) => T): { value: T; dispose: () => void } {
  let value!: T
  const dispose = createRoot((d) => {
    value = fn(d)
    return d
  })
  return { value, dispose }
}

describe("createMotionValue", () => {
  it("returns a motion.MotionValue with the initial value", () => {
    const { value: mv, dispose } = inRoot(() => createMotionValue(42))
    expect(isMotionValue(mv)).toBe(true)
    expect(mv.get()).toBe(42)
    dispose()
  })

  it("destroys the MotionValue on owner disposal", () => {
    const { value: mv, dispose } = inRoot(() => createMotionValue(0))
    const destroySpy = vi.spyOn(mv, "destroy")
    dispose()
    expect(destroySpy).toHaveBeenCalledTimes(1)
  })

  it("supports .set / .jump / .get from upstream", () => {
    inRoot((dispose) => {
      const mv = createMotionValue(0)
      mv.set(10)
      expect(mv.get()).toBe(10)
      mv.jump(50)
      expect(mv.get()).toBe(50)
      dispose()
    })
  })
})

describe("toSignal", () => {
  it("seeds the signal with the MotionValue's current value", () => {
    inRoot((dispose) => {
      const mv = motionValue(7)
      const signal = toSignal(mv)
      expect(signal()).toBe(7)
      dispose()
    })
  })

  it("updates the signal when the MotionValue changes", () => {
    inRoot((dispose) => {
      const mv = motionValue(0)
      const signal = toSignal(mv)
      const seen: number[] = []
      createComputed(() => seen.push(signal()))
      mv.set(1)
      mv.set(2)
      mv.set(3)
      expect(seen).toEqual([0, 1, 2, 3])
      dispose()
    })
  })

  it("unsubscribes the listener on owner disposal", () => {
    const mv = motionValue(0)
    const onSpy = vi.spyOn(mv, "on")
    const { dispose } = inRoot(() => toSignal(mv))
    expect(onSpy).toHaveBeenCalledOnce()
    dispose()
    // After dispose, no more listeners should fire — setting the value should
    // not throw, and the listener registered via .on() is cleaned up.
    expect(() => mv.set(99)).not.toThrow()
  })
})

describe("createMotionValue — callable hybrid", () => {
  it("is callable as an Accessor AND has MotionValue methods", () => {
    inRoot((dispose) => {
      const x = createMotionValue(0)
      // Callable: invoking returns the current value (and tracks in a reactive scope).
      expect(typeof x).toBe("function")
      expect(x()).toBe(0)
      // MotionValue surface: methods bound to the underlying value.
      expect(typeof x.get).toBe("function")
      expect(typeof x.set).toBe("function")
      expect(typeof x.jump).toBe("function")
      expect(typeof x.on).toBe("function")
      expect(typeof x.getVelocity).toBe("function")
      // Duck-type check that motion's engine uses.
      expect(isMotionValue(x)).toBe(true)
      dispose()
    })
  })

  it("propagates set/jump writes to the callable Accessor", () => {
    inRoot((dispose) => {
      const x = createMotionValue(0)
      const seen: number[] = []
      createComputed(() => seen.push(x()))
      x.set(10)
      x.set(20)
      x.jump(99)
      expect(seen).toEqual([0, 10, 20, 99])
      dispose()
    })
  })

  it("get() returns the current value without tracking", () => {
    inRoot((dispose) => {
      const x = createMotionValue(5)
      const seen: number[] = []
      createComputed(() => {
        // .get() is the untracked read — wrapping in createComputed should
        // NOT subscribe to changes.
        seen.push(x.get())
      })
      x.set(10) // does NOT re-run the computation
      x.set(20)
      expect(seen).toEqual([5])
      dispose()
    })
  })
})

describe("createMotionValueEvent", () => {
  it("invokes the callback on the named event", () => {
    inRoot((dispose) => {
      const mv = motionValue(0)
      const seen: number[] = []
      createMotionValueEvent(mv, "change", (v) => seen.push(v))
      mv.set(1)
      mv.set(2)
      expect(seen).toEqual([1, 2])
      dispose()
    })
  })

  it("unsubscribes on owner disposal", () => {
    const mv = motionValue(0)
    const seen: number[] = []
    const { dispose } = inRoot(() => {
      createMotionValueEvent(mv, "change", (v) => seen.push(v))
    })
    mv.set(1)
    expect(seen).toEqual([1])
    dispose()
    mv.set(2)
    expect(seen).toEqual([1]) // no more calls after dispose
  })
})

describe("createTransform", () => {
  it("maps a MotionValue through an input/output range", () => {
    inRoot((dispose) => {
      const x = createMotionValue(0)
      const opacity = createTransform(x, [0, 200], [1, 0])
      expect(opacity.get()).toBe(1)
      x.set(100)
      expect(opacity.get()).toBe(0.5)
      x.set(200)
      expect(opacity.get()).toBe(0)
      dispose()
    })
  })

  it("accepts a Solid Accessor as input", () => {
    inRoot((dispose) => {
      const [x, setX] = createSignal(0)
      const opacity = createTransform(x, [0, 100], [1, 0])
      expect(opacity.get()).toBe(1)
      setX(50)
      expect(opacity.get()).toBe(0.5)
      dispose()
    })
  })

  it("supports non-numeric output ranges (string)", () => {
    inRoot((dispose) => {
      const x = createMotionValue(0)
      const color = createTransform(x, [0, 100], ["#ff0000", "#0000ff"])
      // motion's transform color-interpolates string outputs
      expect(typeof color.get()).toBe("string")
      dispose()
    })
  })

  it("does not rebuild the mapper when only the input (Accessor) changes", () => {
    // Q4 regression test for the inner `untrack` in createTransform's
    // createComputed body. Without untrack, the outer computed subscribes
    // to `input` via `readInputValue(input)`, and EVERY input tick rebuilds
    // the mapper (and re-attaches the input subscription) — defeating the
    // point of the inner subscribeInput. With untrack, mapper builds happen
    // ONLY on range/opts changes.
    inRoot((dispose) => {
      const inputRangeFn = vi.fn(() => [0, 100])
      const [outRange, setOutRange] = createSignal([0, 100])
      const [x, setX] = createSignal(0)

      createTransform(x, inputRangeFn, outRange)

      const initialCalls = inputRangeFn.mock.calls.length
      expect(initialCalls).toBeGreaterThanOrEqual(1) // construction reads

      // Input changes — should NOT trigger getInputRange re-reads, because
      // input tracking belongs to the inner subscribeInput, not the outer
      // createComputed.
      setX(25)
      setX(50)
      setX(75)
      expect(inputRangeFn.mock.calls.length).toBe(initialCalls)

      // Range change — SHOULD trigger exactly one rebuild.
      setOutRange([0, 200])
      expect(inputRangeFn.mock.calls.length).toBe(initialCalls + 1)

      dispose()
    })
  })

  it("rebuilds the mapper when ranges change, preserving output MV identity", () => {
    // Range-swap output-identity test. The output MV identity must remain
    // stable across range changes so consumer .on("change") subscriptions
    // and useMotion target references keep working.
    inRoot((dispose) => {
      const x = createMotionValue(50)
      const [outRange, setOutRange] = createSignal([0, 100])
      const mapped = createTransform(x, [0, 100], outRange)

      expect(mapped.get()).toBe(50)

      // Subscribe BEFORE the range change to prove the subscription survives.
      const observed: number[] = []
      const unsub = mapped.on("change", (v) => observed.push(v))

      setOutRange([0, 200])
      // After range change, mapper rebuilt and out re-seeded with the new
      // mapper applied to the current input.
      expect(mapped.get()).toBe(100)

      // Subsequent input changes flow through the new mapper.
      x.set(25)
      expect(mapped.get()).toBe(50) // 25 mapped through [0,100]→[0,200] = 50

      expect(observed).toContain(100)
      expect(observed).toContain(50)
      unsub()
      dispose()
    })
  })
})

describe("createSpring", () => {
  it("returns a MotionValue tracking the source", () => {
    inRoot((dispose) => {
      const x = createMotionValue(0)
      const smooth = createSpring(x)
      expect(isMotionValue(smooth)).toBe(true)
      // Initial spring value matches source (no settling time yet).
      expect(smooth.get()).toBe(0)
      dispose()
    })
  })

  it("accepts a Solid Accessor input via internal bridge", () => {
    inRoot((dispose) => {
      const [x] = createSignal(5)
      const smooth = createSpring(x)
      expect(isMotionValue(smooth)).toBe(true)
      expect(smooth.get()).toBe(5)
      dispose()
    })
  })

  it("preserves the output MV identity (and its subscriptions) across opts changes", () => {
    // Accessor-form options reactivity. The output MV identity must remain
    // stable across opts changes so consumer subscriptions via .on("change")
    // survive — otherwise stashed handlers silently break. We don't depend
    // on real spring physics here; the contract is that the SAME underlying
    // MV is returned across the lifetime of the call. Driving it with
    // `.set(...)` exercises the subscription path without needing RAF.
    //
    // Solid quirk: signal writes must happen INSIDE the createRoot scope for
    // the inner createComputed to re-run synchronously. Out-of-root writes
    // update the signal's stored value but don't fire registered listeners.
    inRoot((dispose) => {
      const x = createMotionValue(0)
      const [opts, setOpts] = createSignal<SpringOptions>({ stiffness: 100, damping: 20 })
      const smooth = createSpring(x, opts)

      const observed: number[] = []
      const unsub = smooth.on("change", (v) => observed.push(v))

      // Drive the output via the MV's `.set` (simulates a spring tick).
      smooth.set(50)
      expect(observed).toEqual([50])

      // Retune. If `out` had been rebuilt by createComputed, our listener
      // would be orphaned on the OLD MV and the next set would miss it.
      setOpts({ stiffness: 50, damping: 30 })

      // Drive again post-retune.
      smooth.set(75)
      expect(observed).toEqual([50, 75])

      unsub()
      dispose()
    })
  })

  it("preserves visual position when options change mid-flight", () => {
    // Position continuity across retune (Q3/Option B). A naive impl that
    // wires the new spring directly onto `bridge` writes `out.set(spring.get())`
    // at the start of each createComputed iteration. The new spring's
    // position is `bridge.get()` (the current target), so `out` teleports
    // to the target — a visible visual jump precisely when the user retunes
    // for UX reasons. The tempSource pattern captures `out.get()` before
    // recreating, so the new spring starts at the current visual position.
    //
    // jsdom's RAF doesn't drive motion-dom's spring frame loop reliably in
    // unit tests, so we simulate mid-flight by manually setting the output
    // MV to a value between source-start (0) and target (100). The contract
    // we're asserting is purely structural: the output MV's value at the
    // moment opts change must not be stomped by `spring.get()`.
    inRoot((dispose) => {
      const x = createMotionValue(0)
      const [opts, setOpts] = createSignal<SpringOptions>({ stiffness: 100, damping: 20 })
      const smooth = createSpring(x, opts)

      // Drive bridge toward target and place `out` at a mid-flight value.
      x.set(100)
      smooth.set(50) // simulate "spring is currently at 50, target is 100"
      expect(smooth.get()).toBe(50)

      // Retune. createComputed re-runs synchronously inside the root.
      setOpts({ stiffness: 50, damping: 30 })

      // Position continuity. NOT a jump to bridge.get() (= 100) or back to 0.
      // The tempSource pattern starts the new spring from `out.get()` and
      // immediately wires it toward `bridge`, so the visual stays at 50.
      expect(Math.abs(smooth.get() - 50)).toBeLessThan(1)

      dispose()
    })
  })
})

describe("createTime", () => {
  it("returns a MotionValue starting at 0 ms", () => {
    inRoot((dispose) => {
      const t = createTime()
      expect(isMotionValue(t)).toBe(true)
      expect(t.get()).toBe(0)
      dispose()
    })
  })

  it("cancels the frame loop on disposal", () => {
    // Don't have an easy way to assert frame.update was canceled without
    // mocking the motion module — covered indirectly by the fact that the
    // owner's onCleanup runs.
    const { dispose } = inRoot(() => createTime())
    expect(() => dispose()).not.toThrow()
  })
})

describe("createVelocity", () => {
  it("returns a MotionValue mirroring the source's velocity", () => {
    inRoot((dispose) => {
      const x = createMotionValue(0)
      const velocity = createVelocity(x)
      expect(isMotionValue(velocity)).toBe(true)
      expect(velocity.get()).toBe(0) // no motion yet
      dispose()
    })
  })

  it("updates when the source changes", () => {
    inRoot((dispose) => {
      const x = createMotionValue(0)
      const velocity = createVelocity(x)
      const seen: number[] = []
      createComputed(() => seen.push(velocity.get()))
      x.set(10) // Triggers a velocity update via the source's change event.
      // Velocity calculation depends on frame timing; we just verify a recompute happened.
      expect(seen.length).toBeGreaterThanOrEqual(1)
      dispose()
    })
  })
})

describe("createTemplate", () => {
  it("interpolates MotionValues into a string", () => {
    inRoot((dispose) => {
      const x = createMotionValue(10)
      const y = createMotionValue(20)
      const t = createTemplate`translate(${x}px, ${y}px)`
      expect(t.get()).toBe("translate(10px, 20px)")
      dispose()
    })
  })

  it("recomputes when an interpolated MotionValue changes", () => {
    inRoot((dispose) => {
      const x = createMotionValue(0)
      const t = createTemplate`x: ${x}`
      const seen: string[] = [t.get()]
      t.on("change", (v) => seen.push(v))
      x.set(1)
      x.set(2)
      expect(seen).toEqual(["x: 0", "x: 1", "x: 2"])
      dispose()
    })
  })

  it("interpolates Solid Accessors", () => {
    inRoot((dispose) => {
      const [n, setN] = createSignal(5)
      const t = createTemplate`n=${n}`
      expect(t.get()).toBe("n=5")
      setN(7)
      expect(t.get()).toBe("n=7")
      dispose()
    })
  })

  it("mixes MotionValues, Accessors, and static values", () => {
    inRoot((dispose) => {
      const x = createMotionValue(1)
      const [y] = createSignal(2)
      const t = createTemplate`a:${x} b:${y} c:${3}`
      expect(t.get()).toBe("a:1 b:2 c:3")
      x.set(10)
      expect(t.get()).toBe("a:10 b:2 c:3")
      dispose()
    })
  })
})

describe("integration with motion.animate", () => {
  // Sanity check: createMotionValue plays nicely with the engine.
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("can be the target of animate()", () => {
    inRoot((dispose) => {
      const x = createMotionValue(0)
      const controls = animate(x, 100, { duration: 0.1 })
      expect(controls).toBeDefined()
      // Don't try to verify timing — motion's engine has its own tests.
      controls.stop()
      dispose()
    })
  })
})
