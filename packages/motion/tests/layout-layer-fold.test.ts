import { type MotionValue, motionValue } from "motion"
import { describe, expect, it } from "vitest"
import { foldLayoutLayerIntoTarget, type LayoutLayer } from "../src/primitives/value-registry"
import { targetToStyle } from "../src/style"
import type { Target } from "../src/types"

// Cast helper — `motionValue(0)` returns `MotionValue<number>` but the
// LayoutLayer fields are `MotionValue<number>` (specifically numeric);
// the cast keeps the test ergonomic without weakening the runtime
// type contract.
const numMV = (n: number): MotionValue<number> => motionValue(n)

describe("foldLayoutLayerIntoTarget", () => {
  describe("translate fold (additive)", () => {
    it("adds layer.x to numeric user.x", () => {
      const target: Record<string, unknown> = { x: 100 }
      const layer: LayoutLayer = { x: numMV(-50) }
      foldLayoutLayerIntoTarget(target, layer)
      expect(target.x).toBe(50)
    })

    it("uses layer.x alone when target.x is undefined", () => {
      const target: Record<string, unknown> = {}
      const layer: LayoutLayer = { x: numMV(30) }
      foldLayoutLayerIntoTarget(target, layer)
      expect(target.x).toBe(30)
    })

    it("adds layer.y to numeric user.y", () => {
      const target: Record<string, unknown> = { y: 10 }
      const layer: LayoutLayer = { y: numMV(20) }
      foldLayoutLayerIntoTarget(target, layer)
      expect(target.y).toBe(30)
    })

    it("composes string user.x with layer via calc() (positive layer)", () => {
      const target: Record<string, unknown> = { x: "50%" }
      const layer: LayoutLayer = { x: numMV(20) }
      foldLayoutLayerIntoTarget(target, layer)
      expect(target.x).toBe("calc(50% + 20px)")
    })

    it("composes string user.x with layer via calc() (negative layer uses `-` operator)", () => {
      // Direct interpolation of -30 produces invalid CSS `calc(50% + -30px)`;
      // the fold must split into `-` operator + absolute value.
      const target: Record<string, unknown> = { x: "50%" }
      const layer: LayoutLayer = { x: numMV(-30) }
      foldLayoutLayerIntoTarget(target, layer)
      expect(target.x).toBe("calc(50% - 30px)")
    })

    it("leaves string user.x unchanged when layer is exactly 0", () => {
      const target: Record<string, unknown> = { x: "50%" }
      const layer: LayoutLayer = { x: numMV(0) }
      foldLayoutLayerIntoTarget(target, layer)
      expect(target.x).toBe("50%")
    })

    it("nests calc() when user.x is already a calc expression", () => {
      const target: Record<string, unknown> = { x: "calc(50% - 10px)" }
      const layer: LayoutLayer = { x: numMV(20) }
      foldLayoutLayerIntoTarget(target, layer)
      expect(target.x).toBe("calc(calc(50% - 10px) + 20px)")
    })

    it("composes x and y folds independently", () => {
      const target: Record<string, unknown> = { x: 100, y: 200 }
      const layer: LayoutLayer = { x: numMV(-30), y: numMV(-40) }
      foldLayoutLayerIntoTarget(target, layer)
      expect(target).toMatchObject({ x: 70, y: 160 })
    })

    it("leaves x untouched when layer has only y", () => {
      const target: Record<string, unknown> = { x: 100, y: 50 }
      const layer: LayoutLayer = { y: numMV(-10) }
      foldLayoutLayerIntoTarget(target, layer)
      expect(target.x).toBe(100)
      expect(target.y).toBe(40)
    })
  })

  describe("scale fold (multiplicative)", () => {
    it("multiplies layer.scaleX into user scaleX", () => {
      const target: Record<string, unknown> = { scaleX: 2 }
      const layer: LayoutLayer = { scaleX: numMV(0.5) }
      foldLayoutLayerIntoTarget(target, layer)
      expect(target.scaleX).toBe(1)
    })

    it("multiplies layer.scaleY into user scaleY", () => {
      const target: Record<string, unknown> = { scaleY: 2 }
      const layer: LayoutLayer = { scaleY: numMV(0.25) }
      foldLayoutLayerIntoTarget(target, layer)
      expect(target.scaleY).toBe(0.5)
    })

    it("expands user `scale` shortcut into scaleX/scaleY and drops `scale`", () => {
      // 2 × 0.5 = 1.0 exactly (avoids IEEE-754 1.5 × 0.8 = 1.2000000000000002 noise).
      const target: Record<string, unknown> = { scale: 2 }
      const layer: LayoutLayer = { scaleX: numMV(0.5), scaleY: numMV(0.5) }
      foldLayoutLayerIntoTarget(target, layer)
      expect(target).toMatchObject({ scaleX: 1, scaleY: 1 })
      expect("scale" in target).toBe(false)
    })

    it("expands `scale` even when layer covers only one axis (preserves other axis from `scale`)", () => {
      const target: Record<string, unknown> = { scale: 1.5 }
      const layer: LayoutLayer = { scaleX: numMV(0.5) }
      foldLayoutLayerIntoTarget(target, layer)
      expect(target.scaleX).toBe(0.75)
      // scaleY inherits the user's `scale` (1.5) multiplied by layer's
      // implicit factor (1, since layer has no scaleY).
      expect(target.scaleY).toBe(1.5)
      expect("scale" in target).toBe(false)
    })

    it("uses layer values directly when target has no scale at all", () => {
      const target: Record<string, unknown> = {}
      const layer: LayoutLayer = { scaleX: numMV(0.5), scaleY: numMV(0.5) }
      foldLayoutLayerIntoTarget(target, layer)
      // Both axes default to 1 (user-side) × 0.5 (layer) = 0.5.
      expect(target.scaleX).toBe(0.5)
      expect(target.scaleY).toBe(0.5)
    })

    it("preserves user.scaleX over user.scale when both present", () => {
      const target: Record<string, unknown> = { scale: 1.5, scaleX: 2 }
      const layer: LayoutLayer = { scaleX: numMV(0.5), scaleY: numMV(0.5) }
      foldLayoutLayerIntoTarget(target, layer)
      // scaleX uses the more-specific user value (2), not user.scale (1.5).
      // scaleY falls back to user.scale (1.5) × layer (0.5) = 0.75.
      expect(target.scaleX).toBe(1)
      expect(target.scaleY).toBe(0.75)
      expect("scale" in target).toBe(false)
    })

    it("composes string user.scaleX with layer via calc()", () => {
      const target: Record<string, unknown> = { scaleX: "var(--base)" }
      const layer: LayoutLayer = { scaleX: numMV(0.5) }
      foldLayoutLayerIntoTarget(target, layer)
      expect(target.scaleX).toBe("calc((var(--base)) * 0.5)")
    })

    it("leaves string user.scaleX unchanged when layer is exactly 1", () => {
      const target: Record<string, unknown> = { scaleX: "var(--base)" }
      const layer: LayoutLayer = { scaleX: numMV(1) }
      foldLayoutLayerIntoTarget(target, layer)
      expect(target.scaleX).toBe("var(--base)")
    })

    it("propagates string user.scale to non-folded axis when only one axis has a layer", () => {
      // Layer covers scaleX only. User's `scale: "var(--s)"` is the
      // shortcut for both axes. The fold expands: scaleX gets a calc()
      // composition; scaleY must inherit "var(--s)" explicitly so its
      // semantics survive the `scale` delete.
      const target: Record<string, unknown> = { scale: "var(--s)" }
      const layer: LayoutLayer = { scaleX: numMV(0.5) }
      foldLayoutLayerIntoTarget(target, layer)
      expect(target.scaleX).toBe("calc((var(--s)) * 0.5)")
      expect(target.scaleY).toBe("var(--s)")
      expect("scale" in target).toBe(false)
    })
  })

  describe("composed fold + targetToStyle emission", () => {
    it("emits the expected transform string for a typical FLIP delta", () => {
      // Float-safe values: 2 × 0.5 = 1.0 exactly.
      const target: Record<string, unknown> = { x: 100, scale: 2 }
      const layer: LayoutLayer = {
        x: numMV(-50),
        scaleX: numMV(0.5),
        scaleY: numMV(0.5),
      }
      foldLayoutLayerIntoTarget(target, layer)
      const style = targetToStyle(target as Target)
      expect(style.transform).toBe("translateX(50px) scaleX(1) scaleY(1)")
    })

    it("emits translate-only when layer covers only translate axes", () => {
      const target: Record<string, unknown> = {}
      const layer: LayoutLayer = { x: numMV(20), y: numMV(30) }
      foldLayoutLayerIntoTarget(target, layer)
      const style = targetToStyle(target as Target)
      expect(style.transform).toBe("translateX(20px) translateY(30px)")
    })

    it("emits scale-only when layer covers only scale axes", () => {
      const target: Record<string, unknown> = {}
      const layer: LayoutLayer = { scaleX: numMV(0.5), scaleY: numMV(0.5) }
      foldLayoutLayerIntoTarget(target, layer)
      const style = targetToStyle(target as Target)
      expect(style.transform).toBe("scaleX(0.5) scaleY(0.5)")
    })

    it("emits empty target as empty style when layer is empty", () => {
      const target: Record<string, unknown> = {}
      const layer: LayoutLayer = {}
      foldLayoutLayerIntoTarget(target, layer)
      const style = targetToStyle(target as Target)
      expect(style.transform).toBeUndefined()
    })

    it("composes user rotate with layer translate", () => {
      const target: Record<string, unknown> = { rotate: 45, x: 100 }
      const layer: LayoutLayer = { x: numMV(-30) }
      foldLayoutLayerIntoTarget(target, layer)
      const style = targetToStyle(target as Target)
      // TRANSFORM_ORDER: translateX, rotate.
      expect(style.transform).toBe("translateX(70px) rotate(45deg)")
    })
  })

  describe("empty layer", () => {
    it("is a no-op", () => {
      const target: Record<string, unknown> = { x: 100, scale: 1.5 }
      const layer: LayoutLayer = {}
      foldLayoutLayerIntoTarget(target, layer)
      expect(target).toEqual({ x: 100, scale: 1.5 })
    })
  })
})
