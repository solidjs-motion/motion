import { isPrimaryPointer, time } from "motion-dom"
import { createEffect, onCleanup } from "solid-js"
import { createStore, type Store } from "solid-js/store"
import type { PanInfo } from "../types"

// ---------------------------------------------------------------------------
// createPan — standalone pan-session primitive (Q11/c).
//
// Phase 2 Commit 5 (Q11/D3): this is the pointer-session machinery that
// Commit 6's createDrag will use as its underlying event source. Drag IS a
// pan that owns the element's transform; pan on its own is callback-only
// (no `whilePan` state).
//
// Return shape — a single path-tracked {@link Store} of `{ isPanning } &
// PanInfo`. Users read via path (`pan.isPanning`, `pan.point.x`) — Solid's
// store path-tracking means each field has its own reactive subscription
// created lazily on first read. Don't destructure (breaks the proxy);
// always go through the returned reference.
//
// The session:
//   pointerdown    → reset per-session fields, attach window listeners
//   pointermove(s) → update info every move (Option X — includes pre-
//                    threshold so consumers can render threshold-progress
//                    or early-detect fast pans); once cumulative offset
//                    crosses `threshold`, isPanning flips true and
//                    onPanStart fires; subsequent moves fire onPan
//   pointerup      → flip isPanning false; if pan happened, fire onPanEnd;
//                    point/delta/offset/velocity RETAINED (useful for
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

/** The store-shaped state {@link createPan} returns. */
export type PanState = { isPanning: boolean } & PanInfo

/** Zero state — used as the initial value AND on each pointerdown reset. */
function zeroState(): PanState {
  return {
    isPanning: false,
    point: { x: 0, y: 0 },
    delta: { x: 0, y: 0 },
    offset: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
  }
}

/**
 * Observe pointer-driven pan gestures on an element.
 *
 * Returns a {@link Store} `{ isPanning, point, delta, offset, velocity }`.
 * Reading any path is reactive via Solid's path-tracking — `pan.point.x`
 * subscribes only to point-x changes, not velocity or isPanning.
 *
 * - `pan.isPanning` — `true` between onPanStart and onPanEnd.
 * - `pan.point` — current pointer position in client coordinates.
 * - `pan.delta` — delta since last pointermove.
 * - `pan.offset` — cumulative offset since the current pointerdown.
 * - `pan.velocity` — sliding-window velocity in px/sec.
 *
 * Fields update from `pointerdown` forward (including pre-threshold moves)
 * — gate reads on `pan.isPanning` if you only care about real pans.
 *
 * @example
 * const [el, setEl] = createSignal<HTMLElement>()
 * const pan = createPan(el)
 *
 * <div ref={setEl}>
 *   <Show when={pan.isPanning}>
 *     Position: {pan.point.x}, {pan.point.y}
 *   </Show>
 * </div>
 */
export function createPan(
  ref: () => HTMLElement | null | undefined,
  options: CreatePanOptions = {},
): Store<PanState> {
  const [state, setState] = createStore<PanState>(zeroState())

  // createEffect — Solid-idiomatic for side-effect setup (DOM listeners).
  // First iteration runs in the next microtask, which is harmless here: a
  // freshly-mounted element can't receive pointer events between the ref
  // callback firing and the next microtask. Re-runs (ref changes) carry the
  // same harmless delay.
  //
  // Note: Phase 1's createInView / createScroll use createComputed for the
  // same kind of setup work. A follow-up commit (see TODO) will migrate
  // those to createEffect too for consistency with this primitive.
  createEffect(() => {
    const el = ref()
    if (!el) return

    const threshold = options.threshold ?? DEFAULT_THRESHOLD

    // Session state — reset on each pointerdown. Scoped per createComputed
    // iteration; cleanup below reaches all listeners regardless of phase.
    let startPoint: Point | null = null
    let lastPoint: Point | null = null
    let pointerId: number | null = null
    let isPanning = false
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

    /** Push a freshly-computed info snapshot into the reactive store. */
    function writeInfo(info: PanInfo): void {
      // Granular setStore calls — each path is its own subscription, so
      // consumers reading e.g. only `pan.velocity.x` are only invalidated
      // when velocity.x changes (path-tracking).
      setState("point", info.point)
      setState("delta", info.delta)
      setState("offset", info.offset)
      setState("velocity", info.velocity)
    }

    function onPointerDown(event: PointerEvent): void {
      // motion-dom's isPrimaryPointer filters secondary buttons (mouse) and
      // secondary touch points. Same gating Q13c established for press.
      if (!isPrimaryPointer(event)) return

      startPoint = pointOf(event)
      lastPoint = startPoint
      pointerId = event.pointerId
      isPanning = false
      samples = [{ t: time.now(), point: startPoint }]

      // Reset per-session fields. Point goes to start; delta/offset/velocity
      // zero. isPanning false (threshold not crossed yet).
      //
      // IMPORTANT: pass a COPY of startPoint, not startPoint itself. Solid's
      // setState mutates the wrapped object in place on subsequent writes,
      // so sharing a reference between the closure (startPoint) and the
      // store would corrupt the closure variable as pointermoves arrive.
      setState({
        isPanning: false,
        point: { x: startPoint.x, y: startPoint.y },
        delta: { x: 0, y: 0 },
        offset: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
      })

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
      // Consumers gate on `state.isPanning` for "real pan" semantics.
      writeInfo(info)

      if (!isPanning) {
        // Threshold gate: pan hasn't started yet.
        const distance = Math.hypot(info.offset.x, info.offset.y)
        if (distance >= threshold) {
          isPanning = true
          setState("isPanning", true)
          options.onPanStart?.(event, info)
        }
      } else {
        options.onPan?.(event, info)
      }
      lastPoint = point
    }

    function onPointerEnd(event: PointerEvent): void {
      if (event.pointerId !== pointerId) return
      // onPanEnd only fires if onPanStart fired — pan-cancelled-before-start
      // (mere clicks) shouldn't emit lifecycle callbacks.
      if (isPanning) {
        options.onPanEnd?.(event, buildInfo(event))
      }
      isPanning = false
      // Flip isPanning. Point/delta/offset/velocity are RETAINED (option Q5/3)
      // so consumers can read the final state for snap-to-end animations.
      // Next pointerdown will reset them.
      setState("isPanning", false)
      startPoint = null
      lastPoint = null
      pointerId = null
      samples = []
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerEnd)
      window.removeEventListener("pointercancel", onPointerEnd)
    }

    el.addEventListener("pointerdown", onPointerDown)

    // Iteration-scoped cleanup: fires when the ref changes (createComputed
    // re-runs) AND when the owner disposes. Removes all listeners regardless
    // of whether a session was in progress.
    onCleanup(() => {
      el.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerEnd)
      window.removeEventListener("pointercancel", onPointerEnd)
    })
  })

  return state
}
