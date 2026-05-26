import { isPrimaryPointer, time } from "motion-dom"
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js"
import type { MotionValueAccessor, PanInfo } from "../types"
import { createMotionValue } from "./motion-value"

// ---------------------------------------------------------------------------
// createPan — standalone pan-session primitive (Q11/c).
//
// Phase 2 Commit 5 (Q11/D3): pointer-session machinery that createDrag uses
// as its underlying event source. Drag IS a pan that owns the element's
// transform; pan on its own is callback-only (no `whilePan` state).
//
// Return shape — a SEMANTIC split between animate-able numeric values
// (MotionValueAccessors) and non-animate-able state (a plain Accessor):
//
//   - `point.x/y`, `delta.x/y`, `offset.x/y`, `velocity.x/y` → each is a
//     {@link MotionValueAccessor}<number>. Calling them (`pan.point.x()`) is
//     Solid-tracked; the full MotionValue surface (`.get`, `.set`, `.on`,
//     `.getVelocity`) is available; they compose directly with `animate()`,
//     `createTransform`, `useMotion` targets, and JSX reactivity.
//   - `isPanning` → a plain `Accessor<boolean>`. Booleans aren't animate-able,
//     so wrapping in an MV would only add weight.
//
// Why MotionValues for the numeric fields? Composability. Users can pipe
// `pan.point.x` straight into `createTransform`, `animate()`, or use it as
// a target in `useMotion({ animate: { x: pan.point.x } })` — same surface
// Phase 1 established for every animate-able value in the library.
//
// The session:
//   pointerdown    → reset per-session MVs to start point / zeros, attach
//                    window listeners
//   pointermove(s) → update MVs every move (Option X — pre-threshold too,
//                    so consumers can render threshold-progress or
//                    early-detect fast pans); once cumulative offset
//                    crosses `threshold`, isPanning flips true and
//                    onPanStart fires; subsequent moves fire onPan
//   pointerup      → flip isPanning false; if pan happened, fire onPanEnd;
//                    point/delta/offset/velocity MVs RETAINED (useful for
//                    snap-to-end animations)
//   pointercancel  → same as pointerup, but the user's gesture was aborted
//
// Velocity tracking (Q15a): sliding window of pointer samples, 200ms wide.
// Velocity = (latest.point − oldest.point) / Δt × 1000 (px/sec). Uses
// motion-dom's `time.now()` so timestamps stay frame-synchronous with the
// rest of motion's pipeline.
// ---------------------------------------------------------------------------

/** Sliding-window width for velocity computation (Q15a). */
const VELOCITY_WINDOW_MS = 200
/** Default movement threshold before onPanStart fires (Q11a, matches motion). */
const DEFAULT_THRESHOLD = 3

type Point = { x: number; y: number }

export type CreatePanOptions = {
  /** Fires once after pointer movement crosses the threshold. */
  onPanStart?: (event: PointerEvent, info: PanInfo) => void
  /** Fires on every pointermove after onPanStart, until pointerup/cancel. */
  onPan?: (event: PointerEvent, info: PanInfo) => void
  /**
   * Fires on pointerup OR pointercancel after onPanStart has fired.
   * If the pointer was released before the threshold was crossed, onPanEnd
   * is NOT fired (no pan ever happened).
   */
  onPanEnd?: (event: PointerEvent, info: PanInfo) => void
  /**
   * Minimum cumulative offset (in px) before onPanStart fires. Distinguishes
   * pan from click. Default: 3px (motion's default).
   */
  threshold?: number
}

/** Per-axis pair of {@link MotionValueAccessor}s — `pan.point`, `pan.delta`, etc. */
export type PanAxisPair = {
  x: MotionValueAccessor<number>
  y: MotionValueAccessor<number>
}

/**
 * Returned by {@link createPan}. `isPanning` is a plain Accessor (booleans
 * aren't animate-able). The four numeric pairs are MotionValueAccessors,
 * each composable with `animate()`, `createTransform`, and `useMotion`.
 */
export type CreatePanResult = {
  isPanning: Accessor<boolean>
  point: PanAxisPair
  delta: PanAxisPair
  offset: PanAxisPair
  velocity: PanAxisPair
}

/**
 * Observe pointer-driven pan gestures on an element.
 *
 * Returns `{ isPanning, point, delta, offset, velocity }`:
 *
 * - `pan.isPanning()` — Solid Accessor; `true` between onPanStart and onPanEnd.
 * - `pan.point.x`, `pan.point.y` — current pointer position in client coords.
 *   Each is a {@link MotionValueAccessor}: call `pan.point.x()` for a tracked
 *   read, `pan.point.x.get()` for an untracked snapshot, and pass it directly
 *   to `animate()`, `createTransform`, or `useMotion` targets.
 * - `pan.delta.x/y` — delta since last pointermove.
 * - `pan.offset.x/y` — cumulative offset since the current pointerdown.
 * - `pan.velocity.x/y` — sliding-window velocity in px/sec.
 *
 * Fields update from `pointerdown` forward (including pre-threshold moves)
 * — gate reads on `pan.isPanning()` if you only care about real pans.
 *
 * The `ref` argument accepts EITHER a Solid Accessor returning the element
 * OR a static HTMLElement. The accessor form re-attaches pointer listeners
 * when the accessor's return value changes; the static form captures the
 * element once — reassignment of the variable does NOT re-attach.
 *
 * The `options` argument accepts either a static object or an accessor
 * (matching `useMotion`'s convention). The accessor form is read INSIDE
 * each pointer-event handler, so reactive option changes apply on the next
 * relevant event without re-attaching listeners.
 *
 * @example Static options
 * const pan = createPan(el, {
 *   onPanStart: (e, info) => console.log("start", info.point),
 *   threshold: 3,
 * })
 *
 * @example Reactive options (function form — signals tracked)
 * const [threshold, setThreshold] = createSignal(3)
 * const pan = createPan(el, () => ({
 *   threshold: threshold(),
 *   onPanStart: (e, info) => console.log(info),
 * }))
 *
 * @example Composing pan.point.x with createTransform
 * const pan = createPan(el)
 * const rotation = createTransform(pan.point.x, [0, 300], [0, 90])
 * <div ref={setEl} style={{ transform: `rotate(${rotation()}deg)` }} />
 *
 * @example Reading reactively in JSX
 * const pan = createPan(el)
 * <Show when={pan.isPanning()}>
 *   Position: {pan.point.x()}, {pan.point.y()}
 * </Show>
 */
export function createPan(
  ref: Accessor<HTMLElement | null | undefined> | HTMLElement | null | undefined,
  options: CreatePanOptions | Accessor<CreatePanOptions> = {},
): CreatePanResult {
  // Normalize ref + options to function form. A static HTMLElement is
  // captured once via a constant accessor — no re-attach on variable
  // reassignment; pass the accessor form for reactive refs.
  const getRef: Accessor<HTMLElement | null | undefined> =
    typeof ref === "function" ? (ref as Accessor<HTMLElement | null | undefined>) : () => ref
  // All option reads inside event handlers call getOpts so the latest
  // reactive values are seen on each event.
  const getOpts: Accessor<CreatePanOptions> =
    typeof options === "function" ? options : () => options

  // ---- State surface ----
  // isPanning is a plain signal — booleans aren't animate-able, so a full
  // MotionValue would be dead weight.
  const [isPanning, setIsPanning] = createSignal(false)
  // Eight MVs for the four numeric pairs. Each becomes a callable hybrid via
  // createMotionValue: invokable as a tracked Accessor AND has the full
  // MotionValue surface so consumers can pipe them into `animate()`,
  // `createTransform`, or `useMotion` targets.
  const pointX = createMotionValue(0)
  const pointY = createMotionValue(0)
  const deltaX = createMotionValue(0)
  const deltaY = createMotionValue(0)
  const offsetX = createMotionValue(0)
  const offsetY = createMotionValue(0)
  const velocityX = createMotionValue(0)
  const velocityY = createMotionValue(0)

  // createEffect — Solid-idiomatic for side-effect setup (DOM listeners).
  // First iteration runs in the next microtask, which is harmless here: a
  // freshly-mounted element can't receive pointer events between the ref
  // callback firing and the next microtask. Re-runs (ref changes) carry the
  // same harmless delay.
  createEffect(() => {
    const el = getRef()
    if (!el) return

    // NOTE: threshold and callbacks are read INSIDE the event handlers via
    // getOpts(), not captured here. That way reactive opts changes apply on
    // the next relevant event without re-attaching listeners (which would
    // require this effect to depend on getOpts and re-run on opt changes).

    // Session state — reset on each pointerdown. Scoped per effect iteration;
    // cleanup below reaches all listeners regardless of phase.
    let startPoint: Point | null = null
    let lastPoint: Point | null = null
    let pointerId: number | null = null
    let panning = false
    let samples: Array<{ t: number; point: Point }> = []

    function pointOf(event: PointerEvent): Point {
      return { x: event.clientX, y: event.clientY }
    }

    function computeVelocity(): Point {
      if (samples.length < 2) return { x: 0, y: 0 }
      // biome-ignore lint/style/noNonNullAssertion: length >= 2 guarantees both indices exist
      const first = samples[0]!
      // biome-ignore lint/style/noNonNullAssertion: length >= 2 guarantees both indices exist
      const last = samples[samples.length - 1]!
      const dt = last.t - first.t
      if (dt <= 0) return { x: 0, y: 0 }
      return {
        x: ((last.point.x - first.point.x) / dt) * 1000,
        y: ((last.point.y - first.point.y) / dt) * 1000,
      }
    }

    function buildInfo(event: PointerEvent): PanInfo {
      const point = pointOf(event)
      const delta = lastPoint
        ? { x: point.x - lastPoint.x, y: point.y - lastPoint.y }
        : { x: 0, y: 0 }
      const offset = startPoint
        ? { x: point.x - startPoint.x, y: point.y - startPoint.y }
        : { x: 0, y: 0 }
      const velocity = computeVelocity()
      return { point, delta, offset, velocity }
    }

    /** Push a freshly-computed info snapshot into the MVs. Each `.set` fires
     * the MV's change subscription, which the callable-hybrid bridge
     * forwards to Solid; consumers reading e.g. only `pan.velocity.x()` only
     * re-run when velocity.x actually changes — pre-existing MotionValue
     * granularity, not Store path-tracking. */
    function writeInfo(info: PanInfo): void {
      pointX.set(info.point.x)
      pointY.set(info.point.y)
      deltaX.set(info.delta.x)
      deltaY.set(info.delta.y)
      offsetX.set(info.offset.x)
      offsetY.set(info.offset.y)
      velocityX.set(info.velocity.x)
      velocityY.set(info.velocity.y)
    }

    function onPointerDown(event: PointerEvent): void {
      // motion-dom's isPrimaryPointer filters secondary buttons (mouse) and
      // secondary touch points. Same gating Q13c established for press.
      if (!isPrimaryPointer(event)) return

      startPoint = pointOf(event)
      lastPoint = startPoint
      pointerId = event.pointerId
      panning = false
      samples = [{ t: time.now(), point: startPoint }]

      // Reset per-session fields. Point goes to start; delta/offset/velocity
      // zero. isPanning false (threshold not crossed yet).
      setIsPanning(false)
      pointX.set(startPoint.x)
      pointY.set(startPoint.y)
      deltaX.set(0)
      deltaY.set(0)
      offsetX.set(0)
      offsetY.set(0)
      velocityX.set(0)
      velocityY.set(0)

      // Listen on window so events keep firing even when the pointer leaves
      // the element (e.g., during a fast drag). Mirrors motion-dom's press.
      window.addEventListener("pointermove", onPointerMove)
      window.addEventListener("pointerup", onPointerEnd)
      window.addEventListener("pointercancel", onPointerEnd)
    }

    function onPointerMove(event: PointerEvent): void {
      // Multi-touch / unrelated pointers ignored.
      if (event.pointerId !== pointerId) return

      const point = pointOf(event)
      const now = time.now()

      // Append sample, drop everything outside the 200ms window.
      samples.push({ t: now, point })
      const cutoff = now - VELOCITY_WINDOW_MS
      while (samples.length > 1 && (samples[0]?.t ?? 0) < cutoff) {
        samples.shift()
      }

      const info = buildInfo(event)
      // Option X — info updates on EVERY move, including pre-threshold.
      // Consumers gate on `isPanning()` for "real pan" semantics.
      writeInfo(info)

      if (!panning) {
        // Threshold gate: pan hasn't started yet. Read threshold fresh from
        // getOpts() so reactive changes apply (a session in progress sticks
        // with the threshold it saw when this branch first crossed).
        const threshold = getOpts().threshold ?? DEFAULT_THRESHOLD
        const distance = Math.hypot(info.offset.x, info.offset.y)
        if (distance >= threshold) {
          panning = true
          setIsPanning(true)
          getOpts().onPanStart?.(event, info)
        }
      } else {
        getOpts().onPan?.(event, info)
      }
      lastPoint = point
    }

    function onPointerEnd(event: PointerEvent): void {
      if (event.pointerId !== pointerId) return
      // onPanEnd only fires if onPanStart fired — pan-cancelled-before-start
      // (mere clicks) shouldn't emit lifecycle callbacks.
      if (panning) {
        getOpts().onPanEnd?.(event, buildInfo(event))
      }
      panning = false
      // Flip isPanning. Point/delta/offset/velocity MVs are RETAINED
      // (option Q5/3) so consumers can read the final state for
      // snap-to-end animations. Next pointerdown will reset them.
      setIsPanning(false)
      startPoint = null
      lastPoint = null
      pointerId = null
      samples = []
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerEnd)
      window.removeEventListener("pointercancel", onPointerEnd)
    }

    el.addEventListener("pointerdown", onPointerDown)

    // Iteration-scoped cleanup: fires when the ref changes (effect re-runs)
    // AND when the owner disposes. Removes all listeners regardless of
    // whether a session was in progress.
    onCleanup(() => {
      el.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerEnd)
      window.removeEventListener("pointercancel", onPointerEnd)
    })
  })

  return {
    isPanning,
    point: { x: pointX, y: pointY },
    delta: { x: deltaX, y: deltaY },
    offset: { x: offsetX, y: offsetY },
    velocity: { x: velocityX, y: velocityY },
  }
}
