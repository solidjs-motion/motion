// Type-level tests. expectTypeOf assertions are checked at compile time —
// the test file is verified by `tsc --noEmit` (our typecheck script) and
// Vitest also surfaces type errors via the `vitest typecheck` mode. Pure
// shape verification; no runtime behavior.

import type { Accessor, Component, JSX } from "solid-js"
import { describe, expectTypeOf, it } from "vitest"

import {
  type AnimateValue,
  type AnimationPlaybackControls,
  createMotionValue,
  type DragControls,
  type ElementProps,
  type MotionMergedProps,
  type MotionOptions,
  type MotionValue,
  type MotionValueAccessor,
  type PanInfo,
  type PressInfo,
  type ResolvedValues,
  type Target,
  type Transition,
  type UseMotionResult,
  useMotion,
  type Variants,
  type ViewportOptions,
} from "../src"

// ---------------------------------------------------------------------------
// useMotion's return shape: a callable function with a Provider property.
// ---------------------------------------------------------------------------

describe("useMotion return type", () => {
  it("is callable AND has a Provider component", () => {
    const m = useMotion({ animate: { x: 100 } })

    // Call signature: returns merged props.
    expectTypeOf(m).toBeFunction()
    expectTypeOf(m()).toExtend<{
      style: JSX.CSSProperties
      ref: (el: HTMLElement) => void
    }>()

    // Provider is a Solid Component accepting children.
    expectTypeOf(m.Provider).toEqualTypeOf<Component<{ children: JSX.Element }>>()
  })

  it("matches the public UseMotionResult alias", () => {
    const m = useMotion({})
    expectTypeOf(m).toExtend<UseMotionResult>()
  })

  it("preserves user prop keys, replacing ref/style with merged versions", () => {
    const m = useMotion({ initial: { opacity: 0 } })
    const merged = m({ class: "card", onClick: () => {} })
    // class and onClick pass through; ref + style replaced.
    expectTypeOf(merged).toExtend<{
      class: string
      style: JSX.CSSProperties
      ref: (el: HTMLElement) => void
    }>()
  })

  it("data-motion-hydrated is optional empty-string", () => {
    const m = useMotion({ initial: { opacity: 0 } })
    const merged = m()
    expectTypeOf(merged["data-motion-hydrated"]).toEqualTypeOf<"" | undefined>()
  })
})

// ---------------------------------------------------------------------------
// MotionOptions: accept all the option keys with right narrowing.
// ---------------------------------------------------------------------------

describe("MotionOptions", () => {
  it("accepts all animation states and gestures", () => {
    expectTypeOf<MotionOptions>().toExtend<{
      initial?: AnimateValue | false
      animate?: AnimateValue
      exit?: AnimateValue
      hover?: AnimateValue
      press?: AnimateValue
      focus?: AnimateValue
      inView?: AnimateValue
      transition?: Transition
      variants?: Variants
      custom?: unknown
      inViewOptions?: ViewportOptions
    }>()
  })

  it("accepts the full lifecycle hook surface", () => {
    expectTypeOf<MotionOptions>().toExtend<{
      onAnimationStart?: () => void
      onAnimationComplete?: (definition: AnimateValue) => void
      onAnimationCancel?: () => void
      onUpdate?: (latest: ResolvedValues) => void
      onHoverStart?: (e: PointerEvent) => void
      onHoverEnd?: (e: PointerEvent) => void
      onPressStart?: (e: PointerEvent, info: PressInfo) => void
      onPress?: (e: PointerEvent, info: PressInfo) => void
      onPressCancel?: (e: PointerEvent, info: PressInfo) => void
      onFocus?: (e: FocusEvent) => void
      onBlur?: (e: FocusEvent) => void
      onPanStart?: (e: PointerEvent, info: PanInfo) => void
      onPan?: (e: PointerEvent, info: PanInfo) => void
      onPanEnd?: (e: PointerEvent, info: PanInfo) => void
      onDragStart?: (e: PointerEvent, info: PanInfo) => void
      onDrag?: (e: PointerEvent, info: PanInfo) => void
      onDragEnd?: (e: PointerEvent, info: PanInfo) => void
    }>()
  })

  it("accepts drag options", () => {
    expectTypeOf<MotionOptions>().toExtend<{
      drag?: boolean | "x" | "y"
      dragElastic?: number
      dragMomentum?: boolean
      dragSnapToOrigin?: boolean
      dragControls?: DragControls
    }>()
  })
})

// ---------------------------------------------------------------------------
// Target type — strict transform shorthand + numeric narrowing + value union
// ---------------------------------------------------------------------------

describe("Target", () => {
  it("accepts numeric, string, MotionValue, Accessor for transform shorthand", () => {
    const x = createMotionValue(0)
    const sig: Accessor<number> = () => 10
    const target: Target = {
      x: 100, // number
      y: "50%", // string with unit
      z: x, // MotionValue
      rotate: sig, // Accessor
      scale: 0.9,
      scaleX: 1.2,
      opacity: 0.5,
    }
    expectTypeOf(target).toExtend<Target>()
  })

  it("accepts keyframe arrays per property", () => {
    const target: Target = {
      x: [0, 50, 100],
      opacity: [0, 1, 0],
      scale: [1, 1.2, 1],
    }
    expectTypeOf(target).toExtend<Target>()
  })

  it("accepts a per-target transition override", () => {
    const target: Target = {
      x: 100,
      transition: { duration: 0.5 },
    }
    expectTypeOf(target).toExtend<Target>()
  })

  it("accepts CSS variables via index signature", () => {
    const target: Target = {
      "--accent": "#f0f",
      "--scale": 1.2,
    }
    expectTypeOf(target).toExtend<Target>()
  })

  it("accepts arbitrary CSS properties via index signature", () => {
    const target: Target = {
      backgroundColor: "red",
      borderRadius: 4,
      width: "50%",
    }
    expectTypeOf(target).toExtend<Target>()
  })

  it("rejects scale being a non-numeric/MotionValue/Accessor value", () => {
    // @ts-expect-error scale must be Numeric (number | MotionValue<number> | Accessor<number>)
    const _bad: Target = { scale: { foo: "bar" } }
  })
})

// ---------------------------------------------------------------------------
// AnimateValue — Target | string | string[]
// ---------------------------------------------------------------------------

describe("AnimateValue", () => {
  it("accepts a Target object", () => {
    const v: AnimateValue = { x: 100, opacity: 0.5 }
    expectTypeOf(v).toExtend<AnimateValue>()
  })

  it("accepts a variant name (string)", () => {
    const v: AnimateValue = "visible"
    expectTypeOf(v).toExtend<AnimateValue>()
  })

  it("accepts a variant name array", () => {
    const v: AnimateValue = ["visible", "highlighted"]
    expectTypeOf(v).toExtend<AnimateValue>()
  })
})

// ---------------------------------------------------------------------------
// Variants — Record<string, Target | function>
// ---------------------------------------------------------------------------

describe("Variants", () => {
  it("accepts object variants", () => {
    const v: Variants = {
      visible: { opacity: 1, x: 0 },
      hidden: { opacity: 0, x: 100 },
    }
    expectTypeOf(v).toExtend<Variants>()
  })

  it("accepts function variants with a custom param", () => {
    const v: Variants = {
      visible: (i: unknown) => ({ x: (i as number) * 10 }),
    }
    expectTypeOf(v).toExtend<Variants>()
  })

  it("accepts a mix of object and function variants", () => {
    const v: Variants = {
      hidden: { opacity: 0 },
      visible: (i) => ({ opacity: 1, x: (i as number) * 5 }),
    }
    expectTypeOf(v).toExtend<Variants>()
  })
})

// ---------------------------------------------------------------------------
// createMotionValue — callable hybrid (MotionValueAccessor)
// ---------------------------------------------------------------------------

describe("createMotionValue — MotionValueAccessor shape", () => {
  it("returns a value that's both callable AND a MotionValue", () => {
    const x = createMotionValue(42)
    // Callable as a Solid Accessor: invoking returns the underlying value.
    expectTypeOf(x).toBeCallableWith()
    expectTypeOf(x()).toEqualTypeOf<number>()
    // MotionValue surface: .get, .set, .jump, .on, .getVelocity exist.
    expectTypeOf(x.get()).toEqualTypeOf<number>()
    expectTypeOf(x.set).toBeFunction()
    expectTypeOf(x.jump).toBeFunction()
    expectTypeOf(x.on).toBeFunction()
    expectTypeOf(x.getVelocity).toBeFunction()
    // Assignable to both base types.
    expectTypeOf(x).toExtend<MotionValueAccessor<number>>()
    expectTypeOf(x).toExtend<MotionValue<number>>()
  })

  it("preserves the value type for non-number types", () => {
    const s = createMotionValue("hello")
    expectTypeOf(s).toExtend<MotionValueAccessor<string>>()
    expectTypeOf(s()).toEqualTypeOf<string>()
    expectTypeOf(s.get()).toEqualTypeOf<string>()
  })

  it("is acceptable as both a MotionValue input AND an Accessor input", () => {
    // Used to verify functions that accept `MotionValue | Accessor` also
    // accept the hybrid. Compile-time only.
    const x = createMotionValue(0)
    const asAccessor: Accessor<number> = x
    const asMotionValue: MotionValue<number> = x
    expectTypeOf(asAccessor).toExtend<Accessor<number>>()
    expectTypeOf(asMotionValue).toExtend<MotionValue<number>>()
  })
})

// ---------------------------------------------------------------------------
// ElementProps + MotionMergedProps shape
// ---------------------------------------------------------------------------

describe("ElementProps / MotionMergedProps", () => {
  it("MotionMergedProps strips user's ref/style and injects motion's", () => {
    // Phase 4: ref type widened to MotionElement (HTMLElement | SVGElement)
    // so `motion.path` and friends can attach refs without a cast.
    type UserProps = {
      class: string
      ref?: (el: HTMLElement | SVGElement) => void
      style?: { color: string }
    }
    type Merged = MotionMergedProps<UserProps>
    expectTypeOf<Merged>().toExtend<{
      class: string
      ref: (el: HTMLElement | SVGElement) => void
      style: JSX.CSSProperties
    }>()
    // user's `ref` and `style` types are replaced, not the wider element-props ones
    expectTypeOf<Merged["style"]>().toEqualTypeOf<JSX.CSSProperties>()
  })
})

// ---------------------------------------------------------------------------
// useMotion accepts both static options and a reactive function form
// ---------------------------------------------------------------------------

describe("useMotion input forms", () => {
  it("accepts static MotionOptions", () => {
    const m1 = useMotion({ animate: { x: 100 } })
    expectTypeOf(m1).toExtend<UseMotionResult>()
  })

  it("accepts a function returning MotionOptions (reactive form)", () => {
    const m2 = useMotion(() => ({ animate: { x: 100 } }))
    expectTypeOf(m2).toExtend<UseMotionResult>()
  })
})

// ---------------------------------------------------------------------------
// Re-exported motion types are usable
// ---------------------------------------------------------------------------

describe("re-exported types", () => {
  it("Transition, MotionValue, AnimationPlaybackControls, PanInfo, PressInfo are exported", () => {
    expectTypeOf<Transition>().not.toBeAny()
    expectTypeOf<MotionValue<number>>().not.toBeAny()
    expectTypeOf<AnimationPlaybackControls>().not.toBeAny()
    expectTypeOf<PanInfo>().not.toBeAny()
    expectTypeOf<PressInfo>().not.toBeAny()
    expectTypeOf<ResolvedValues>().not.toBeAny()
  })
})

// ---------------------------------------------------------------------------
// Type-level negative cases: things that SHOULD be type errors
// ---------------------------------------------------------------------------

describe("type errors (negative tests)", () => {
  it("opacity must be Numeric", () => {
    // @ts-expect-error opacity is typed Keyframes<Numeric>; objects aren't valid
    const _bad: Target = { opacity: { foo: 1 } }
  })

  it("MotionOptions.initial accepts false but not other booleans", () => {
    // @ts-expect-error initial must be AnimateValue | false, not true
    const _bad: MotionOptions = { initial: true }
  })

  it("variants must be Record<string, Variant>", () => {
    // @ts-expect-error variants is a record, not an array
    const _bad: MotionOptions = { variants: [{ x: 0 }] }
  })

  it("hover accepts AnimateValue, not unrelated shapes", () => {
    // @ts-expect-error hover must be AnimateValue (Target | string | string[]); number is not valid
    const _bad: MotionOptions = { hover: 42 }
  })
})

// Helper: ensure ElementProps is exported & visible (the type alias itself).
type _AssertElementPropsExported = ElementProps
