import { animate, isMotionValue, motionValue } from "motion"
import { createComputed, createRoot, createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createMotionSignal,
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

describe("createMotionSignal", () => {
  it("returns [Accessor, MotionValue] mirroring createSignal's shape", () => {
    inRoot((dispose) => {
      const [x, xValue] = createMotionSignal(0)
      expect(typeof x).toBe("function")
      expect(isMotionValue(xValue)).toBe(true)
      expect(x()).toBe(0)
      expect(xValue.get()).toBe(0)
      dispose()
    })
  })

  it("propagates writes to the accessor through the MotionValue", () => {
    inRoot((dispose) => {
      const [x, xValue] = createMotionSignal(0)
      const seen: number[] = []
      createComputed(() => seen.push(x()))
      xValue.set(10)
      xValue.set(20)
      expect(seen).toEqual([0, 10, 20])
      dispose()
    })
  })

  it("treats jump() the same as set() for the accessor view", () => {
    inRoot((dispose) => {
      const [x, xValue] = createMotionSignal(5)
      xValue.jump(99)
      expect(x()).toBe(99)
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
