import { createRoot } from "solid-js"
import { bench, describe } from "vitest"
import { createMotionValue } from "../src/primitives/motion-value"

// What this measures
// ------------------
// Per-allocation cost of `createMotionValue(initial)`. Each call:
//   1. Allocates an upstream `motion.motionValue()` (motion-dom primitive).
//   2. Wraps it in a Solid Proxy that forwards .getVelocity / .get / .set
//      to the underlying MV AND exposes itself as a tracked Solid Accessor.
//   3. Establishes a subscription bridge (the MV's `on("change", ...)`
//      pushes to a Solid signal so consumers calling the callable hybrid
//      get fine-grained reactivity).
//
// The Proxy + subscription bridge is what costs more than a bare Solid
// signal would; this bench pins how much.

describe("createMotionValue construction", () => {
  bench("createMotionValue(0)", () => {
    createRoot((dispose) => {
      createMotionValue(0)
      dispose()
    })
  })

  bench("createMotionValue('100px')", () => {
    createRoot((dispose) => {
      createMotionValue("100px")
      dispose()
    })
  })

  bench("createMotionValue × 10 in one root", () => {
    createRoot((dispose) => {
      for (let i = 0; i < 10; i++) createMotionValue(i)
      dispose()
    })
  })
})
