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
import type { MotionValueAccessor } from "../types"

// ---------------------------------------------------------------------------
// MotionValue events the engine can fire — kept narrow so TypeScript autocomplete
// surfaces only the documented surface.
// ---------------------------------------------------------------------------

type MotionValueEvent = "change" | "animationStart" | "animationComplete" | "animationCancel"

// ---------------------------------------------------------------------------
// makeAccessor — wrap a raw motion.MotionValue as a callable hybrid. Invoking
// `mv()` returns a Solid-tracked read; every MotionValue method (.get, .set,
// .jump, .on, .getVelocity, etc.) forwards to the underlying value. Both
// `isMotionValue(mv)` (duck-typed on .getVelocity) and `typeof mv === "function"`
// are true; createMotion's splitTarget checks isMotionValue first, so the engine
// treats hybrids as MotionValues.
// ---------------------------------------------------------------------------

function makeAccessor<T>(mv: MotionValue<T>): MotionValueAccessor<T> {
  // Solid signal bridge — kept in sync via `mv.on("change", ...)`.
  const [signal, setSignal] = createSignal<T>(mv.get())
  // Wrap in updater form so Setter accepts T regardless of its shape (T could
  // include Function for callback-like motion values).
  onCleanup(mv.on("change", (v) => setSignal(() => v)))

  // The callable: invoking returns the tracked signal value.
  const fn = (() => signal()) as MotionValueAccessor<T>

  return new Proxy(fn, {
    get(target, prop, receiver) {
      // Function intrinsics (call/apply/bind) stay on the function itself so
      // `fn.call(...)` etc. behave normally.
      if (prop === "call" || prop === "apply" || prop === "bind") {
        return Reflect.get(target, prop, receiver)
      }
      // If we ever attach our own properties to `fn`, prefer those.
      if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver)
      // Forward to the MotionValue. Methods are bound so `this` is the MV.
      const value = Reflect.get(mv as object, prop, mv)
      return typeof value === "function" ? value.bind(mv) : value
    },
    has(target, prop) {
      return Reflect.has(target, prop) || prop in (mv as object)
    },
  })
}

// ---------------------------------------------------------------------------
// createMotionValue — callable-hybrid MotionValue auto-disposed on cleanup.
// ---------------------------------------------------------------------------

/**
 * Create a {@link MotionValueAccessor} bound to the current reactive scope.
 *
 * The returned value has two access patterns:
 *
 * - `mv()` — invoke as a Solid Accessor. Tracks in JSX, `createEffect`,
 *   `createMemo`, etc.
 * - `mv.get()` / `mv.set(v)` / `mv.jump(v)` / `mv.on(...)` — the full upstream
 *   {@link MotionValue} surface. Matches motion/react idioms.
 *
 * The same value can be passed as a target in
 * `useMotion({ animate: { x: mv } })` (motion engine sees `.getVelocity` via
 * the Proxy and treats it as a motion value) or directly as the target of
 * `animate(mv, 100)`.
 *
 * Auto-destroyed via `onCleanup` when the owner is disposed.
 *
 * @example
 * const x = createMotionValue(0)
 * x.set(100)
 * animate(x, 200, { duration: 0.5 })
 * <p>{x()}</p>           // reactive read in JSX
 */
export function createMotionValue<T>(initial: T): MotionValueAccessor<T> {
  const mv = motionValue(initial)
  const accessor = makeAccessor(mv)
  // Route the cleanup call through the accessor so test-time spies on
  // `accessor.destroy` are invoked (the Proxy forwards to the underlying mv).
  onCleanup(() => accessor.destroy())
  return accessor
}

// ---------------------------------------------------------------------------
// toSignal — adapt any raw MotionValue (e.g. from motion's `motionValue()`
// factory) to a Solid Accessor. Useful when interoperating with motion APIs
// that return raw MotionValues outside our hybrid factories.
// ---------------------------------------------------------------------------

/**
 * Bridge a raw {@link MotionValue} (from motion's `motionValue()` factory or
 * any other motion API that doesn't return our hybrid) to a Solid
 * {@link Accessor}. Seeds with the current value and updates on every
 * `change` event.
 *
 * **You usually don't need this.** Values returned by `createMotionValue`,
 * `createTransform`, `createSpring`, `createTime`, `createVelocity`, and
 * `createTemplate` are already callable — you can do `mv()` directly. Reach
 * for `toSignal` only when you receive a raw MotionValue from an external API.
 *
 * @example
 * import { motionValue } from "motion"
 * const rawMv = motionValue(0)
 * const xSignal = toSignal(rawMv)
 */
export function toSignal<T>(mv: MotionValue<T>): Accessor<T> {
  const [value, setValue] = createSignal<T>(mv.get())
  onCleanup(mv.on("change", (v) => setValue(() => v)))
  return value
}

// ---------------------------------------------------------------------------
// createMotionValueEvent — register a listener with automatic cleanup.
// ---------------------------------------------------------------------------

/**
 * Subscribe to a {@link MotionValue} event with automatic cleanup. Convenience
 * wrapper around `mv.on(event, cb)` for parity with motion/react's
 * `useMotionValueEvent`. For per-change reactivity, prefer
 * `createComputed(() => fn(mv()))` since hybrids are directly callable.
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
// Shared helpers
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
// Returns a MotionValueAccessor so callable behavior is preserved end-to-end.
// ---------------------------------------------------------------------------

type TransformOptions = NonNullable<Parameters<typeof motionTransform>[2]>

/**
 * Create a {@link MotionValueAccessor} that maps an input through a range/
 * output pair. Mirrors motion/react's `useTransform`. The input can be a
 * MotionValue, our hybrid, or any Solid Accessor; the output composes with
 * `animate()`, `useMotion`'s targets, and JSX reactivity.
 *
 * @example
 * const { scrollY } = createScroll()
 * const opacity = createTransform(scrollY, [0, 200], [1, 0])
 * <div style={{ opacity: opacity() }}>...</div>
 */
export function createTransform<I extends number, O>(
  input: MotionValue<I> | Accessor<I>,
  inputRange: I[],
  outputRange: O[],
  options?: TransformOptions,
): MotionValueAccessor<O> {
  const mapper = motionTransform(inputRange, outputRange, options)
  const mv = motionValue(mapper(readInputValue(input)))
  onCleanup(() => mv.destroy())
  subscribeInput(input, (v) => mv.set(mapper(v)))
  return makeAccessor(mv)
}

// ---------------------------------------------------------------------------
// createSpring — produce a MotionValueAccessor that spring-tracks an input.
// ---------------------------------------------------------------------------

/**
 * Spring-smoothed mirror of a numeric input. Returns a
 * {@link MotionValueAccessor} that tracks the source with physics-based easing.
 *
 * @example
 * const x = createMotionValue(0)
 * const smoothX = createSpring(x, { stiffness: 100, damping: 20 })
 */
export function createSpring(
  source: MotionValue<number> | Accessor<number>,
  options?: SpringOptions,
): MotionValueAccessor<number> {
  if (isMotionValue(source)) {
    const mv = springValue(source as MotionValue<number>, options)
    onCleanup(() => mv.destroy())
    return makeAccessor(mv)
  }
  // Accessor input — bridge through an intermediate MotionValue that mirrors it.
  const bridge = motionValue((source as Accessor<number>)())
  onCleanup(() => bridge.destroy())
  createComputed(() => bridge.set((source as Accessor<number>)()))
  const mv = springValue(bridge, options)
  onCleanup(() => mv.destroy())
  return makeAccessor(mv)
}

// ---------------------------------------------------------------------------
// createTime — MotionValueAccessor that advances each frame with elapsed ms.
// ---------------------------------------------------------------------------

/**
 * {@link MotionValueAccessor} that advances every animation frame, holding
 * the milliseconds elapsed since this primitive was called. Driver for
 * time-based animations and {@link createTransform}-derived values.
 *
 * @example
 * const t = createTime()
 * const wobble = createTransform(t, [0, 1000, 2000], [0, 10, 0])
 */
export function createTime(): MotionValueAccessor<number> {
  const mv = motionValue(0)
  onCleanup(() => mv.destroy())
  const startedAt = performance.now()
  const tick = () => mv.set(performance.now() - startedAt)
  frame.update(tick, true)
  onCleanup(() => cancelFrame(tick))
  return makeAccessor(mv)
}

// ---------------------------------------------------------------------------
// createVelocity — MotionValueAccessor mirroring an input's instantaneous velocity.
// ---------------------------------------------------------------------------

/**
 * {@link MotionValueAccessor} reporting the velocity of a source motion value.
 * Updated whenever the source changes.
 *
 * @example
 * const x = createMotionValue(0)
 * const xVelocity = createVelocity(x)
 */
export function createVelocity(source: MotionValue<number>): MotionValueAccessor<number> {
  const mv = motionValue(source.getVelocity())
  onCleanup(() => mv.destroy())
  onCleanup(source.on("change", () => mv.set(source.getVelocity())))
  return makeAccessor(mv)
}

// ---------------------------------------------------------------------------
// createTemplate — tagged template producing a MotionValueAccessor<string>.
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: MotionValue is invariant in T; `any` lets the template accept MotionValues of any value type.
type TemplateInput = MotionValue<any> | Accessor<unknown> | string | number

/**
 * Tagged template producing a {@link MotionValueAccessor}\<string\>.
 * Interpolated {@link MotionValue}s, hybrids, and Solid Accessors recompute
 * the output string on change; primitives and static strings are baked in.
 *
 * @example
 * const x = createMotionValue(0)
 * const y = createMotionValue(0)
 * const transform = createTemplate`translate(${x}px, ${y}px) scale(1.1)`
 * <div style={{ transform: transform() }} />
 */
export function createTemplate(
  strings: TemplateStringsArray,
  ...values: TemplateInput[]
): MotionValueAccessor<string> {
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

  const mv = motionValue(compute())
  onCleanup(() => mv.destroy())

  for (const v of values) {
    if (isMotionValue(v)) {
      onCleanup((v as MotionValue<unknown>).on("change", () => mv.set(compute())))
    }
  }

  const hasAccessor = values.some((v) => typeof v === "function" && !isMotionValue(v))
  if (hasAccessor) {
    createComputed(() => {
      for (const v of values) {
        if (typeof v === "function" && !isMotionValue(v)) (v as Accessor<unknown>)()
      }
      mv.set(compute())
    })
  }

  return makeAccessor(mv)
}
