import { motionValue } from "motion"
import { describe, expect, it } from "vitest"
import { targetToStyle } from "../src/style"
import type { Target } from "../src/types"

describe("targetToStyle", () => {
  describe("primitives", () => {
    it("passes through opacity as a number", () => {
      expect(targetToStyle({ opacity: 0.5 })).toEqual({ opacity: 0.5 })
    })

    it("handles an empty target", () => {
      expect(targetToStyle({})).toEqual({})
    })

    it("emits color strings verbatim", () => {
      expect(targetToStyle({ "background-color": "red", color: "#fff" })).toEqual({
        "background-color": "red",
        color: "#fff",
      })
    })
  })

  describe("transform composition", () => {
    it("translates x as px", () => {
      expect(targetToStyle({ x: 100 })).toEqual({ transform: "translateX(100px)" })
    })

    it("translates y as px", () => {
      expect(targetToStyle({ y: 50 })).toEqual({ transform: "translateY(50px)" })
    })

    it("translates z as px", () => {
      expect(targetToStyle({ z: 10 })).toEqual({ transform: "translateZ(10px)" })
    })

    it("composes multiple transforms in motion order: translate → scale → rotate → skew → perspective", () => {
      const target: Target = {
        skewX: 5,
        rotateY: 30,
        scale: 0.9,
        y: 50,
        transformPerspective: 800,
        x: 100,
        rotate: 45,
      }
      expect(targetToStyle(target)).toEqual({
        transform:
          "translateX(100px) translateY(50px) scale(0.9) rotate(45deg) rotateY(30deg) skewX(5deg) perspective(800px)",
      })
    })

    it("emits rotate values in deg by default", () => {
      expect(targetToStyle({ rotate: 45, rotateX: 90, rotateY: 180, rotateZ: 270 })).toEqual({
        transform: "rotate(45deg) rotateX(90deg) rotateY(180deg) rotateZ(270deg)",
      })
    })

    it("emits skew values in deg by default", () => {
      expect(targetToStyle({ skew: 10, skewX: 5, skewY: 15 })).toEqual({
        transform: "skew(10deg) skewX(5deg) skewY(15deg)",
      })
    })

    it("emits scale values dimensionless", () => {
      expect(targetToStyle({ scale: 1.5, scaleX: 2, scaleY: 0.5, scaleZ: 1 })).toEqual({
        transform: "scale(1.5) scaleX(2) scaleY(0.5) scaleZ(1)",
      })
    })

    it("preserves string units in transform shorthand", () => {
      expect(targetToStyle({ x: "50%", y: "2rem", rotate: "0.5turn" })).toEqual({
        transform: "translateX(50%) translateY(2rem) rotate(0.5turn)",
      })
    })

    it("treats transform-origin as a regular CSS property, not a transform function", () => {
      expect(targetToStyle({ "transform-origin": "top left" })).toEqual({
        "transform-origin": "top left",
      })
    })
  })

  describe("default-unit table", () => {
    it("auto-px on dimensional CSS properties (numbers)", () => {
      const result = targetToStyle({
        width: 100,
        height: 200,
        padding: 16,
        "margin-top": 8,
        "border-radius": 4,
        gap: 12,
        "font-size": 14,
        top: 0,
      })
      expect(result).toEqual({
        width: "100px",
        height: "200px",
        padding: "16px",
        "margin-top": "8px",
        "border-radius": "4px",
        gap: "12px",
        "font-size": "14px",
        top: "0px",
      })
    })

    it("passes strings through dimensional properties without modification", () => {
      expect(targetToStyle({ width: "50%", padding: "1rem" })).toEqual({
        width: "50%",
        padding: "1rem",
      })
    })

    it("does not auto-unit dimensionless properties (opacity, z-index, scale)", () => {
      expect(targetToStyle({ opacity: 0.5, "z-index": 10 })).toEqual({
        opacity: 0.5,
        "z-index": 10,
      })
    })

    it("emits line-height dimensionless always (Q5 sub-2 simplification)", () => {
      expect(targetToStyle({ "line-height": 1.5 })).toEqual({ "line-height": 1.5 })
    })

    it("does not auto-unit unknown CSS properties (number passes through)", () => {
      expect(targetToStyle({ "flex-grow": 1, order: 2 })).toEqual({ "flex-grow": 1, order: 2 })
    })
  })

  describe("keyframe arrays", () => {
    it("uses the first frame as the initial value", () => {
      expect(targetToStyle({ opacity: [0, 0.5, 1] })).toEqual({ opacity: 0 })
    })

    it("composes first-frame transform shorthand", () => {
      expect(targetToStyle({ x: [0, 50, 100] })).toEqual({ transform: "translateX(0px)" })
    })

    it("first-frame null omits the property", () => {
      expect(targetToStyle({ x: [null as unknown as number, 100], opacity: [0, 1] })).toEqual({
        opacity: 0,
      })
    })

    it("first-frame undefined omits the property", () => {
      expect(targetToStyle({ x: [undefined as unknown as number, 100] })).toEqual({})
    })
  })

  describe("MotionValue inputs", () => {
    it("snapshots the current value of a MotionValue", () => {
      const x = motionValue(42)
      expect(targetToStyle({ x })).toEqual({ transform: "translateX(42px)" })
    })

    it("snapshots MotionValues inside non-transform properties", () => {
      const opacity = motionValue(0.3)
      expect(targetToStyle({ opacity })).toEqual({ opacity: 0.3 })
    })

    it("snapshots a MotionValue as the first keyframe", () => {
      const x = motionValue(7)
      expect(targetToStyle({ x: [x as unknown as number, 100] })).toEqual({
        transform: "translateX(7px)",
      })
    })
  })

  describe("Accessor inputs", () => {
    it("invokes a function (Accessor) to read its value", () => {
      const x = () => 99
      expect(targetToStyle({ x })).toEqual({ transform: "translateX(99px)" })
    })

    it("invokes an Accessor in a non-transform property", () => {
      const opacity = () => 0.25
      expect(targetToStyle({ opacity })).toEqual({ opacity: 0.25 })
    })
  })

  describe("CSS variables", () => {
    it("emits string CSS variables verbatim", () => {
      expect(targetToStyle({ "--accent": "#f0f" })).toEqual({ "--accent": "#f0f" })
    })

    it("stringifies number CSS variables without unit guess", () => {
      expect(targetToStyle({ "--scale": 1.2 })).toEqual({ "--scale": "1.2" })
    })
  })

  describe("transition key", () => {
    it("filters out the transition key (animation config, not style)", () => {
      expect(targetToStyle({ x: 100, opacity: 0.5, transition: { duration: 0.5 } })).toEqual({
        opacity: 0.5,
        transform: "translateX(100px)",
      })
    })
  })

  describe("purity contract — required for SSR/hydration determinism", () => {
    it("is deterministic across repeated calls with the same input", () => {
      const target: Target = { x: 100, y: 50, scale: 0.9, opacity: 0.5, padding: 16 }
      const a = targetToStyle(target)
      const b = targetToStyle(target)
      const c = targetToStyle(target)
      expect(a).toEqual(b)
      expect(b).toEqual(c)
    })

    it("does not mutate its input (deep-freeze survives the call)", () => {
      const target: Target = { x: 100, y: 50, scale: 0.9, padding: 16 }
      Object.freeze(target)
      expect(() => targetToStyle(target)).not.toThrow()
    })

    it("does not mutate keyframe arrays", () => {
      const x = Object.freeze([0, 50, 100])
      const target = Object.freeze({ x } as unknown as Target)
      expect(() => targetToStyle(target)).not.toThrow()
    })

    it("produces identical output for two structurally-equal inputs", () => {
      const a = targetToStyle({ x: 1, y: 2, scale: 0.5, opacity: 0.7 })
      const b = targetToStyle({ x: 1, y: 2, scale: 0.5, opacity: 0.7 })
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    })
  })

  describe("golden table — representative end-to-end cases", () => {
    const cases: ReadonlyArray<readonly [string, Target, Record<string, string | number>]> = [
      ["empty", {}, {}],
      ["bare opacity", { opacity: 0.5 }, { opacity: 0.5 }],
      ["bare x", { x: 100 }, { transform: "translateX(100px)" }],
      [
        "x + y + scale combined",
        { x: 100, y: 50, scale: 0.9 },
        { transform: "translateX(100px) translateY(50px) scale(0.9)" },
      ],
      ["rotate (default deg)", { rotate: 45 }, { transform: "rotate(45deg)" }],
      [
        "width + opacity keyframes",
        { width: 100, opacity: [0, 1] },
        { width: "100px", opacity: 0 },
      ],
      ["color string", { "background-color": "red" }, { "background-color": "red" }],
      [
        "css var string",
        { "--accent": "#f0f", padding: 8 },
        { "--accent": "#f0f", padding: "8px" },
      ],
      ["x with string unit", { x: "50%", y: 0 }, { transform: "translateX(50%) translateY(0px)" }],
      ["transition is stripped", { opacity: 0, transition: { duration: 1 } }, { opacity: 0 }],
    ]

    for (const [name, input, expected] of cases) {
      it(name, () => {
        expect(targetToStyle(input)).toEqual(expected)
      })
    }
  })
})
