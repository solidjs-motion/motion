// Stage 2 smoke test for MV-in-style.
//
// We're not aiming for full coverage here — Stage 6 lands the comprehensive
// test pass. This file exists to verify the feature path actually executes
// end-to-end before we layer Stage 3 (animate bridge) on top.
//
// Scope: pass an MV in `style`, mutate it, observe the element's inline
// style update. No animate involved (Stage 2 doesn't bridge animate yet).

import { render } from "@solidjs/testing-library"
import { describe, expect, it } from "vitest"

const { useMotion } = await import("../src/use-motion")
const { createMotionValue } = await import("../src/primitives/motion-value")

describe("MV-in-style — Stage 2 smoke", () => {
  it("subscribes to a MotionValue in style and writes el.style.transform on change", () => {
    const scale = createMotionValue(1)
    let el!: HTMLDivElement
    const { unmount } = render(() => {
      const m = useMotion({})
      // Stage 5 will widen `style`'s type to accept MotionValue. Until then,
      // we cast the literal so the test compiles.
      return (
        <div
          ref={el}
          {...m({
            style: { scale: scale } as never,
          })}
        />
      )
    })

    // Initial subscription fire writes the current value as a composed
    // transform string.
    expect(el.style.transform).toBe("scale(1)")

    scale.set(1.5)
    expect(el.style.transform).toBe("scale(1.5)")

    scale.set(0.5)
    expect(el.style.transform).toBe("scale(0.5)")

    unmount()
  })

  it("strips MV-valued style keys from the merged style output", () => {
    const opacity = createMotionValue(0.5)
    let el!: HTMLDivElement
    const { unmount } = render(() => {
      const m = useMotion({})
      return (
        <div
          ref={el}
          {...m({
            // Mix MV-valued (opacity) and plain (background) keys. The plain
            // one should reach the inline style via Solid's binding; the MV
            // one is written directly by createMotion.
            style: { opacity: opacity as never, background: "red" },
          })}
        />
      )
    })

    expect(el.style.background).toBe("red")
    expect(el.style.opacity).toBe("0.5")

    opacity.set(0.2)
    expect(el.style.opacity).toBe("0.2")

    unmount()
  })

  it("unsubscribes on unmount (no writes after teardown)", () => {
    const scale = createMotionValue(1)
    let el!: HTMLDivElement
    const { unmount } = render(() => {
      const m = useMotion({})
      return (
        <div
          ref={el}
          {...m({
            style: { scale: scale as never },
          })}
        />
      )
    })

    expect(el.style.transform).toBe("scale(1)")

    unmount()

    // The element is detached; capture its transform pre-write, set the MV,
    // and confirm the transform string didn't change (subscription torn
    // down). This is a coarse check — a more rigorous test would assert
    // mv.getOwnSubscriptions() is empty, but motion doesn't expose that.
    const before = el.style.transform
    scale.set(99)
    expect(el.style.transform).toBe(before)
  })

  it("static styles still bind normally when no MVs are in style", () => {
    let el!: HTMLDivElement
    const { unmount } = render(() => {
      const m = useMotion({})
      return (
        <div
          ref={el}
          {...m({
            style: { color: "rebeccapurple", "font-weight": "bold" },
          })}
        />
      )
    })

    expect(el.style.color).toBe("rebeccapurple")
    expect(el.style.fontWeight).toBe("bold")

    unmount()
  })
})
