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
      return (
        <div
          {...m({
            ref: (r) => {
              el = r as HTMLDivElement
            },
            style: { scale: scale },
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
          {...m({
            ref: (r) => {
              el = r as HTMLDivElement
            },
            // Mix MV-valued (opacity) and plain (background) keys. The plain
            // one should reach the inline style via Solid's binding; the MV
            // one is written directly by createMotion.
            style: { opacity: opacity, background: "red" },
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
          {...m({
            ref: (r) => {
              el = r as HTMLDivElement
            },
            style: { scale: scale },
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
          {...m({
            ref: (r) => {
              el = r as HTMLDivElement
            },
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

describe("MV-in-style — Stage 4 initial/style cooperation", () => {
  it("composes initial transform values with style MVs into a single transform string", () => {
    // initial.y=20 lands in the registry as a transient via Stage 4. The
    // style MV (scale) lands as an external. The writer composes both into
    // one transform string instead of letting the style-MV write clobber
    // the initial transform.
    const scale = createMotionValue(0.5)
    let el!: HTMLDivElement
    const { unmount } = render(() => {
      const m = useMotion({ initial: { y: 20 } })
      return (
        <div
          {...m({
            ref: (r) => {
              el = r as HTMLDivElement
            },
            style: { scale: scale },
          })}
        />
      )
    })

    expect(el.style.transform).toBe("translateY(20px) scale(0.5)")

    // Driving the style MV doesn't drop initial.y — the registry still has
    // the transient seeded by Stage 4.
    scale.set(1.2)
    expect(el.style.transform).toBe("translateY(20px) scale(1.2)")

    unmount()
  })

  it("composes when style has multiple transform shortcuts (MV + static + initial)", () => {
    const scale = createMotionValue(0.8)
    let el!: HTMLDivElement
    const { unmount } = render(() => {
      const m = useMotion({ initial: { rotate: 45 } })
      return (
        <div
          {...m({
            ref: (r) => {
              el = r as HTMLDivElement
            },
            // x is a static transform shortcut (no MV) — also flows through
            // the composition. scale is an MV. rotate comes from initial.
            style: { scale: scale, x: 10 },
          })}
        />
      )
    })

    // Composed in motion's canonical order: x, scale, rotate
    expect(el.style.transform).toBe("translateX(10px) scale(0.8) rotate(45deg)")

    scale.set(1.1)
    expect(el.style.transform).toBe("translateX(10px) scale(1.1) rotate(45deg)")

    unmount()
  })

  it("leaves non-transform initial values intact when the writer fires", () => {
    // The writer's applyStaticStyle only touches keys present in its target
    // (registry contents). initial.opacity is non-transform and NOT registered
    // by Stage 4 (only transform shortcuts go in), so it stays on the
    // applyStaticStyle path that ran once at mount.
    const scale = createMotionValue(0.5)
    let el!: HTMLDivElement
    const { unmount } = render(() => {
      const m = useMotion({ initial: { y: 20, opacity: 0 } })
      return (
        <div
          {...m({
            ref: (r) => {
              el = r as HTMLDivElement
            },
            style: { scale: scale },
          })}
        />
      )
    })

    expect(el.style.transform).toBe("translateY(20px) scale(0.5)")
    expect(el.style.opacity).toBe("0")

    scale.set(1)
    expect(el.style.transform).toBe("translateY(20px) scale(1)")
    // opacity still 0 — writer didn't touch it.
    expect(el.style.opacity).toBe("0")

    unmount()
  })
})
