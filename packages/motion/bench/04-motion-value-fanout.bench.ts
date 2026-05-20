import { createEffect, createRoot } from "solid-js"
import { bench, describe } from "vitest"
import { createMotionValue } from "../src/primitives/motion-value"

// What this measures
// ------------------
// The fan-out cost when an MV's value changes — how long it takes to
// notify N tracked subscribers and run their downstream effects.
//
// MotionValue updates are immediate (createComputed-driven, not deferred),
// so the cost model is: 1 MV.set → N createEffect re-runs → measurable
// total time. This pins regressions in the MV → Solid signal bridge or
// in Solid's createEffect throughput at small fan-out counts.
//
// We use `setup` to materialize the subscribers ONCE outside the
// measurement loop; the bench body only runs the .set call and the
// subsequent notify cascade.

describe("createMotionValue fanout — mv.set with K subscribers", () => {
  for (const k of [1, 10, 100] as const) {
    let mv: ReturnType<typeof createMotionValue<number>>
    let dispose: () => void
    let counter = 0

    bench(
      `mv.set fan-out to ${k} subscribers`,
      () => {
        counter++
        mv.set(counter)
      },
      {
        setup: () => {
          createRoot((d) => {
            mv = createMotionValue(0)
            for (let i = 0; i < k; i++) {
              createEffect(() => {
                // Track the MV's callable hybrid. Each createEffect
                // subscribes via the Solid signal bridge.
                mv()
              })
            }
            dispose = d
          })
        },
        teardown: () => {
          dispose?.()
        },
      },
    )
  }
})
