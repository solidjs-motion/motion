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
import { type Accessor, createComputed, createSignal, from, onCleanup, untrack } from "solid-js"
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
  // Solid `from` bridge — seeds with `mv.get()` and re-syncs on every
  // `change` event. The returned accessor is non-undefined because we
  // call `set` synchronously inside the producer; the cast tightens the
  // type so the rest of the hybrid (and consumers like `useMotion`) see
  // `Accessor<T>` rather than `Accessor<T | undefined>`.
  const signal = from<T>((set) => {
    set(() => mv.get())
    return mv.on("change", set)
  }) as MotionValueAccessor<T>

  return new Proxy(signal, {
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
  inputRange: I[] | Accessor<I[]>,
  outputRange: O[] | Accessor<O[]>,
  options?: TransformOptions | Accessor<TransformOptions>,
): MotionValueAccessor<O> {
  const getInputRange: Accessor<I[]> =
    typeof inputRange === "function" ? inputRange : () => inputRange
  const getOutputRange: Accessor<O[]> =
    typeof outputRange === "function" ? outputRange : () => outputRange
  const getOpts: () => TransformOptions | undefined =
    typeof options === "function" ? options : () => options

  // Eager seed — untrack each getter so the calling component's reactive
  // scope (if any) doesn't subscribe to range/opts signals here. The
  // reactive subscription lives in the createComputed below.
  const initialMapper = motionTransform(
    untrack(getInputRange),
    untrack(getOutputRange),
    untrack(getOpts),
  )
  const out = motionValue(initialMapper(readInputValue(input)))
  onCleanup(() => out.destroy())

  // Rebuild mapper + reattach input subscription whenever any of the
  // three reactive inputs change. subscribeInput is called inside
  // createComputed, so its cleanup (whether via onCleanup for MV inputs
  // or createComputed for accessor inputs) is iteration-scoped — the
  // previous subscription tears down before the new mapper takes over.
  //
  // The eager readInputValue(input) MUST be wrapped in untrack: for an
  // Accessor input, a naked read would subscribe the OUTER createComputed
  // to `input`, causing the mapper to rebuild on every input tick instead
  // of only on ranges/opts changes. Input tracking belongs to the inner
  // subscribeInput, not the outer.
  createComputed(() => {
    const mapper = motionTransform(getInputRange(), getOutputRange(), getOpts())
    out.set(mapper(untrack(() => readInputValue(input))))
    subscribeInput(input, (v) => out.set(mapper(v)))
  })

  return makeAccessor(out)
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
  options?: SpringOptions | Accessor<SpringOptions>,
): MotionValueAccessor<number> {
  const getOpts: () => SpringOptions | undefined =
    typeof options === "function" ? options : () => options

  // ---- Stable bridge MV ----
  // Mirrors the source. For an MV source it IS the source (do NOT destroy
  // on cleanup — that would tear down the caller's MV). For an Accessor
  // source we own an intermediate MV driven by the signal.
  let bridge: MotionValue<number>
  if (isMotionValue(source)) {
    bridge = source as MotionValue<number>
  } else {
    bridge = motionValue((source as Accessor<number>)())
    onCleanup(() => bridge.destroy())
    createComputed(() => bridge.set((source as Accessor<number>)()))
  }

  // ---- Stable output MV ----
  // Identity MUST survive opts changes so existing `.on("change")` listeners
  // and `useMotion({ animate: { x: spring } })` references keep working.
  const out = motionValue(bridge.get())
  onCleanup(() => out.destroy())

  // ---- Per-iteration spring + tempSource (preserve-position pattern) ----
  // Naive rewrite would create the spring directly on `bridge`. Because
  // springValue's internal position is initialized from its source's
  // CURRENT value, doing so makes the new spring start at `bridge.get()` —
  // which visually SNAPS `out` from its mid-flight value to the input
  // value the moment the user retunes. The whole point of reactive opts is
  // the spring REACTING, not teleporting.
  //
  // Fix: per iteration, build a `tempSource` MV initialized at the current
  // visual position (`out.get()`). The new spring starts there; we then
  // immediately set tempSource to `bridge.get()` so the spring has work to
  // do. A subscription on `bridge` keeps tempSource tracking the live
  // target for the rest of this iteration's lifetime.
  //
  // Velocity still resets to 0 — motion-dom's springValue has no public
  // API for seeding initial velocity. Documented limitation.
  createComputed(() => {
    const opts = getOpts()
    const startPos = out.get()

    const tempSource = motionValue(startPos)
    onCleanup(() => tempSource.destroy())
    const spring = springValue(tempSource, opts)
    onCleanup(() => spring.destroy())

    // Spring drives out.
    onCleanup(spring.on("change", (v) => out.set(v)))

    // Kick the spring toward the live target.
    tempSource.set(bridge.get())

    // Pipe future bridge changes into tempSource so the spring keeps
    // chasing as the user updates the source.
    onCleanup(bridge.on("change", (v) => tempSource.set(v)))
  })

  return makeAccessor(out)
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
