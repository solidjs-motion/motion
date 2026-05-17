import {
  cancelFrame,
  frame,
  isMotionValue,
  type MotionValue,
  transform as motionTransform,
  motionValue,
  type SpringOptions,
  springValue,
} from "motion"
import { type Accessor, createComputed, createSignal, onCleanup } from "solid-js"

// ---------------------------------------------------------------------------
// MotionValue events the engine can fire — kept narrow so TypeScript autocomplete
// surfaces only the documented surface.
// ---------------------------------------------------------------------------

type MotionValueEvent = "change" | "animationStart" | "animationComplete" | "animationCancel"

// ---------------------------------------------------------------------------
// createMotionValue — bare upstream MotionValue, auto-disposed on cleanup.
// ---------------------------------------------------------------------------

/**
 * Create a {@link MotionValue} bound to the current reactive scope. The value
 * is destroyed automatically via `onCleanup` when the owner is disposed.
 *
 * @example
 * const x = createMotionValue(0)
 * animate(x, 100, { duration: 0.5 })
 * x.get() // current value
 * x.set(50)
 */
export function createMotionValue<T>(initial: T): MotionValue<T> {
  const mv = motionValue(initial)
  onCleanup(() => mv.destroy())
  return mv
}

// ---------------------------------------------------------------------------
// toSignal — adapt a MotionValue to a Solid Accessor via from(). The cast
// drops `| undefined` because MotionValue<T> always has a value.
// ---------------------------------------------------------------------------

/**
 * Bridge a {@link MotionValue} to a Solid {@link Accessor}. The signal seeds
 * with the motion value's current value and updates on every `change` event.
 *
 * @example
 * const x = createMotionValue(0)
 * const xSignal = toSignal(x)
 * createComputed(() => console.log(xSignal()))
 */
export function toSignal<T>(mv: MotionValue<T>): Accessor<T> {
  const [value, setValue] = createSignal<T>(mv.get())
  // Wrap in updater form so Solid's Setter accepts T regardless of its shape.
  onCleanup(mv.on("change", (v) => setValue(() => v)))
  return value
}

// ---------------------------------------------------------------------------
// createMotionSignal — convenience pair: an Accessor for reactive reads and a
// MotionValue for imperative writes / motion-engine consumption.
// ---------------------------------------------------------------------------

/**
 * Returns `[Accessor<T>, MotionValue<T>]` — a Solid-reactive read alongside the
 * MotionValue for `.set()`, `.jump()`, `.get()`, and motion engine integration.
 * Mirrors the shape of {@link createSignal}.
 *
 * @example
 * const [x, xValue] = createMotionSignal(0)
 * xValue.set(100)
 * x()           // reactive read
 * animate(xValue, 200)
 */
export function createMotionSignal<T>(initial: T): [Accessor<T>, MotionValue<T>] {
  const mv = createMotionValue(initial)
  return [toSignal(mv), mv]
}

// ---------------------------------------------------------------------------
// createMotionValueEvent — register a listener with automatic cleanup.
// ---------------------------------------------------------------------------

/**
 * Subscribe to a {@link MotionValue} event with automatic cleanup. Convenience
 * wrapper around `mv.on(event, cb)` for parity with motion/react's
 * `useMotionValueEvent`. For per-change reactivity, prefer
 * `createComputed(() => fn(mv()))` after wrapping with {@link toSignal}.
 *
 * @example
 * const x = createMotionValue(0)
 * createMotionValueEvent(x, "animationComplete", () => console.log("done"))
 */
export function createMotionValueEvent<T>(
  mv: MotionValue<T>,
  event: MotionValueEvent,
  callback: (latest: T) => void,
): void {
  onCleanup(mv.on(event, callback))
}

// ---------------------------------------------------------------------------
// readInputValue — shared helper that handles MotionValue and Accessor inputs.
// ---------------------------------------------------------------------------

function readInputValue<T>(input: MotionValue<T> | Accessor<T>): T {
  if (isMotionValue(input)) return (input as MotionValue<T>).get()
  return (input as Accessor<T>)()
}

function subscribeInput<T>(
  input: MotionValue<T> | Accessor<T>,
  onChange: (value: T) => void,
): void {
  if (isMotionValue(input)) {
    onCleanup((input as MotionValue<T>).on("change", onChange))
  } else {
    createComputed(() => onChange((input as Accessor<T>)()))
  }
}

// ---------------------------------------------------------------------------
// createTransform — interpolate one MotionValue/Accessor through a range.
// Returns a MotionValue so it composes with animate() and style bindings.
// ---------------------------------------------------------------------------

type TransformOptions = NonNullable<Parameters<typeof motionTransform>[2]>

/**
 * Create a {@link MotionValue} that maps an input through a range/output pair.
 * Mirrors motion/react's `useTransform`. The input can be a MotionValue or any
 * Solid Accessor; the output composes with `animate()` and motion-driven
 * `style` bindings.
 *
 * @example
 * const scrollY = createMotionValue(0)
 * const opacity = createTransform(scrollY, [0, 200], [1, 0])
 */
export function createTransform<I extends number, O>(
  input: MotionValue<I> | Accessor<I>,
  inputRange: I[],
  outputRange: O[],
  options?: TransformOptions,
): MotionValue<O> {
  const mapper = motionTransform(inputRange, outputRange, options)
  const mv = createMotionValue(mapper(readInputValue(input)))
  subscribeInput(input, (v) => mv.set(mapper(v)))
  return mv
}

// ---------------------------------------------------------------------------
// createSpring — produce a MotionValue that spring-tracks an input source.
// ---------------------------------------------------------------------------

/**
 * Spring-smoothed mirror of a numeric input. Returns a {@link MotionValue} that
 * tracks the source with physics-based easing.
 *
 * @example
 * const x = createMotionValue(0)
 * const smoothX = createSpring(x, { stiffness: 100, damping: 20 })
 */
export function createSpring(
  source: MotionValue<number> | Accessor<number>,
  options?: SpringOptions,
): MotionValue<number> {
  if (isMotionValue(source)) {
    const mv = springValue(source as MotionValue<number>, options)
    onCleanup(() => mv.destroy())
    return mv
  }
  // Accessor input — bridge through an intermediate MotionValue that mirrors it.
  const bridge = createMotionValue((source as Accessor<number>)())
  createComputed(() => bridge.set((source as Accessor<number>)()))
  const mv = springValue(bridge, options)
  onCleanup(() => mv.destroy())
  return mv
}

// ---------------------------------------------------------------------------
// createTime — a MotionValue that updates each frame with elapsed milliseconds.
// ---------------------------------------------------------------------------

/**
 * Creates a {@link MotionValue} that advances every animation frame, holding
 * the milliseconds elapsed since this primitive was called. Useful as a driver
 * for time-based animations and {@link createTransform}-derived motion values.
 *
 * @example
 * const t = createTime()
 * const wobble = createTransform(t, [0, 1000, 2000], [0, 10, 0])
 */
export function createTime(): MotionValue<number> {
  const mv = createMotionValue(0)
  const startedAt = performance.now()
  const tick = () => mv.set(performance.now() - startedAt)
  // keepAlive=true → schedule indefinitely until cancelFrame
  frame.update(tick, true)
  onCleanup(() => cancelFrame(tick))
  return mv
}

// ---------------------------------------------------------------------------
// createVelocity — a MotionValue mirroring an input's instantaneous velocity.
// ---------------------------------------------------------------------------

/**
 * Creates a {@link MotionValue} that reports the velocity of a source motion
 * value. Updated whenever the source changes.
 *
 * @example
 * const x = createMotionValue(0)
 * const xVelocity = createVelocity(x)
 */
export function createVelocity(source: MotionValue<number>): MotionValue<number> {
  const mv = createMotionValue(source.getVelocity())
  onCleanup(source.on("change", () => mv.set(source.getVelocity())))
  return mv
}

// ---------------------------------------------------------------------------
// createTemplate — tagged template producing a MotionValue<string> that
// follows interpolated MotionValues / Accessors.
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: MotionValue is invariant in T; `any` lets the template accept MotionValues of any value type.
type TemplateInput = MotionValue<any> | Accessor<unknown> | string | number

/**
 * Tagged template producing a {@link MotionValue}\<string\>. Interpolated
 * {@link MotionValue}s and Solid Accessors recompute the output string on
 * change; primitives and static strings are baked in once.
 *
 * @example
 * const x = createMotionValue(0)
 * const y = createMotionValue(0)
 * const transformStr = createTemplate`translate(${x}px, ${y}px) scale(1.1)`
 * <motion.div style={{ transform: transformStr }} />
 */
export function createTemplate(
  strings: TemplateStringsArray,
  ...values: TemplateInput[]
): MotionValue<string> {
  const compute = (): string => {
    let out = ""
    for (let i = 0; i < strings.length; i++) {
      out += strings[i]
      if (i < values.length) {
        const v = values[i]
        if (isMotionValue(v)) {
          out += String((v as MotionValue<unknown>).get())
        } else if (typeof v === "function") {
          out += String((v as Accessor<unknown>)())
        } else {
          out += String(v)
        }
      }
    }
    return out
  }

  const mv = createMotionValue(compute())

  // Subscribe to every MotionValue input — change fires recompute.
  for (const v of values) {
    if (isMotionValue(v)) {
      onCleanup((v as MotionValue<unknown>).on("change", () => mv.set(compute())))
    }
  }

  // Accessors are tracked by a single effect (Solid handles the multi-track).
  const hasAccessor = values.some((v) => typeof v === "function" && !isMotionValue(v))
  if (hasAccessor) {
    createComputed(() => {
      for (const v of values) {
        if (typeof v === "function" && !isMotionValue(v)) (v as Accessor<unknown>)()
      }
      mv.set(compute())
    })
  }

  return mv
}
