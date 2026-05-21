import { type AnimationPlaybackControls, animate } from "motion"
import { HTMLVisualElement, type MotionValue, time, visualElementStore } from "motion-dom"
import { createEffect, onCleanup } from "solid-js"
import type {
  DragConstraints,
  DragControls,
  DragControlsStartOptions,
  MotionOptions,
  PanInfo,
} from "../types"
import { DRAG_CONTROLS_REGISTER } from "./createDragControls"
import { createPan } from "./createPan"
import type { SetActive } from "./gesture-state"

// ---------------------------------------------------------------------------
// createDrag — pointer-driven drag with motion-dom VisualElement composition
// (Q5/C-lean + Q15).
//
// Architecture:
// - Layered on top of createPan (Q11/D3). Pan handles the pointer session
//   (down → threshold-gated start → moves → up/cancel) and exposes its
//   PanInfo via callbacks. Drag adds the side-effects on top: transform
//   writes, body/touchAction styling, pointer capture, state-machine
//   activation, and (Stage 4) momentum.
// - Translation flows through motion-dom's VisualElement system: drag writes
//   to the element's `x`/`y` MotionValues, and motion's render pipeline
//   composes the final transform string. This is why `whileDrag: { scale }`
//   works for free — the scale animation writes a sibling MV and the VE
//   composes all transform-class values into one output (Q5/C-lean).
//
// State machine integration:
// - On pan-start (only if drag is enabled), `setActive("whileDrag", true)`
//   fires. The state machine's `winners` memo then claims whileDrag's
//   target keys, EXCEPT x and y which are filtered (drag owns them).
// - On pan-end, `setActive("whileDrag", false)`. Momentum (Stage 4) runs
//   AFTER whileDrag deactivates — visual gesture state ends with the
//   pointerup, not when the animation settles.
// ---------------------------------------------------------------------------

/**
 * Get or create a motion-dom VisualElement for an HTMLElement. Required
 * because we write to the VE's `x`/`y` MotionValues during drag, and motion
 * only auto-creates the VE inside `animate(el, target)` calls — if a user
 * configures drag without any animate target, no VE would exist.
 *
 * Mirrors framer-motion's `createDOMVisualElement` (which isn't reachable
 * from a non-React context — framer-motion's main entry requires React).
 * The options shape and `mount` + `visualElementStore.set` calls match the
 * upstream implementation. SVG support is omitted for v0.1 — drag on SVG
 * is an unusual case.
 */
function ensureVisualElement(el: HTMLElement): InstanceType<typeof HTMLVisualElement> {
  const existing = visualElementStore.get(el)
  if (existing) return existing as InstanceType<typeof HTMLVisualElement>

  // motion-dom's VisualElement options type expects more fields than we
  // can sensibly provide without React-flavored MotionProps. The runtime
  // needs only the visualState shape and an empty props bag.
  const options = {
    presenceContext: null,
    props: {},
    visualState: {
      renderState: {
        transform: {},
        transformOrigin: {},
        style: {},
        vars: {},
        attrs: {},
      },
      latestValues: {},
    },
  }
  // biome-ignore lint/suspicious/noExplicitAny: VisualElement options type expects React-flavored MotionProps we can't supply.
  const ve = new HTMLVisualElement(options as any)
  ve.mount(el)
  visualElementStore.set(el, ve)
  return ve as InstanceType<typeof HTMLVisualElement>
}

/**
 * Parse the visible translate from an element's transform — reads both
 * `getComputedStyle(el).transform` (which real browsers normalize to
 * matrix form) AND `el.style.transform` (which preserves the raw syntax
 * motion-dom's writer emits, e.g. `translate3d(50px, 0px, 0)`). Used by
 * drag's pan-start to sync the x/y MotionValues to what the user is
 * actually seeing.
 *
 * Why both sources: motion's `animate(el, target)` interpolates style.
 * transform via WAAPI but DOESN'T update the VE's MVs during the tween,
 * so after `initial: {x:-300} → animate: {x:0}` the MV still holds -300.
 * Reading the current transform recovers the truth. We prefer computed
 * (post-animation, post-WAAPI-commit value) and fall back to inline
 * (covers jsdom + cases where motion's writer wrote inline but the
 * browser hasn't run a style-resolve pass yet).
 *
 * Supported syntaxes:
 *   - `"none"` / empty → {0, 0}
 *   - `matrix(a, b, c, d, tx, ty)`
 *   - `matrix3d(..., tx, ty, ...)`
 *   - `translateX(Npx)` / `translateY(Npx)` / `translate(tx, ty)`
 *   - `translate3d(tx, ty, tz)`
 *   - Any of the above mixed with other transform functions (regex-
 *     based extraction picks just the translate components).
 */
function readVisibleTranslate(el: HTMLElement): { x: number; y: number } {
  const fromString = (transform: string): { x: number; y: number } | null => {
    if (!transform || transform === "none") return null

    if (transform.startsWith("matrix3d(")) {
      const values = transform.slice(9, -1).split(",")
      const tx = Number.parseFloat(values[12] ?? "0")
      const ty = Number.parseFloat(values[13] ?? "0")
      if (!Number.isFinite(tx) && !Number.isFinite(ty)) return null
      return { x: Number.isFinite(tx) ? tx : 0, y: Number.isFinite(ty) ? ty : 0 }
    }
    if (transform.startsWith("matrix(")) {
      const values = transform.slice(7, -1).split(",")
      const tx = Number.parseFloat(values[4] ?? "0")
      const ty = Number.parseFloat(values[5] ?? "0")
      if (!Number.isFinite(tx) && !Number.isFinite(ty)) return null
      return { x: Number.isFinite(tx) ? tx : 0, y: Number.isFinite(ty) ? ty : 0 }
    }

    // motion-dom's writer emits the keyword form: `translate3d(...)`,
    // `translateX(...)`, etc. — usually as the first segment of a
    // composed transform like `translate3d(50px, 0px, 0) scale(1)`.
    let x = 0
    let y = 0
    let found = false
    const translate3d = transform.match(/translate3d\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px/)
    if (translate3d) {
      x = Number.parseFloat(translate3d[1] ?? "0")
      y = Number.parseFloat(translate3d[2] ?? "0")
      found = true
    } else {
      const translate2d = transform.match(/translate\(\s*([-\d.]+)px\s*(?:,\s*([-\d.]+)px)?/)
      if (translate2d) {
        x = Number.parseFloat(translate2d[1] ?? "0")
        y = Number.parseFloat(translate2d[2] ?? "0")
        found = true
      }
      const translateX = transform.match(/translateX\(\s*([-\d.]+)px/)
      if (translateX) {
        x = Number.parseFloat(translateX[1] ?? "0")
        found = true
      }
      const translateY = transform.match(/translateY\(\s*([-\d.]+)px/)
      if (translateY) {
        y = Number.parseFloat(translateY[1] ?? "0")
        found = true
      }
    }
    if (!found) return null
    return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 }
  }

  return fromString(getComputedStyle(el).transform) ?? fromString(el.style.transform) ?? { x: 0, y: 0 }
}

/**
 * Compute the `touch-action` CSS value for an element being dragged.
 * Disabling touch-action prevents the browser from interpreting the gesture
 * as a scroll. Axis-locked drags leave the unused axis available for scroll
 * (so a horizontally-draggable card can still be scrolled vertically by the
 * surrounding page).
 */
function touchActionFor(drag: MotionOptions["drag"]): string {
  if (drag === "x") return "pan-y"
  if (drag === "y") return "pan-x"
  return "none"
}

/**
 * Resolved drag bounds expressed as absolute MotionValue bounds (Q5/C-lean —
 * drag writes absolute values, so we clamp in MV-space, not offset-space).
 * `Infinity` / `-Infinity` represent "unbounded in that direction."
 */
type ResolvedBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * Resolve a {@link DragConstraints} value into absolute MotionValue bounds at
 * drag-start. Two input shapes (Q8):
 *
 * - **Numeric** (`{ top, left, right, bottom }`): bounds are absolute MV
 *   values. `left: -100` means x cannot go below -100.
 * - **HTMLElement or `() => HTMLElement | null`**: container that the
 *   dragged element must stay inside. Bounds are computed from the
 *   container's bounding rect vs the dragged element's current rect, then
 *   re-centered around the current MV values.
 *
 * The element form is resolved ONCE at drag-start (current viewport rects).
 * Reactive constraint changes mid-drag aren't honored in v0.1 — they'd
 * require re-measuring on each pointermove. Acceptable corner case.
 *
 * Returns `null` when constraints are unset or the accessor returns null —
 * caller treats as "no clamping, no elastic resistance."
 */
function resolveConstraints(
  constraints: DragConstraints | undefined,
  el: HTMLElement,
  dragStartX: number,
  dragStartY: number,
): ResolvedBounds | null {
  if (!constraints) return null

  // Discriminate variants with `instanceof HTMLElement` first — this rules
  // out HTMLElement so the `typeof === "function"` check below narrows
  // cleanly to the accessor variant. (TS gets confused if we test the
  // function form first; HTMLElement instances have many methods on their
  // prototype, which can muddle TS's narrowing logic.)
  let container: HTMLElement | null = null
  if (constraints instanceof HTMLElement) {
    container = constraints
  } else if (typeof constraints === "function") {
    container = constraints()
  }

  if (container) {
    // Element-form: compute offset bounds from rects, then add dragStart
    // so we get absolute MV bounds. Subtle but important: the element's
    // current rect already includes any applied transform (including the
    // current dragStart translation), so we add dragStart back to convert
    // "allowable offset from current position" to "allowable absolute MV
    // value."
    const containerRect = container.getBoundingClientRect()
    const elementRect = el.getBoundingClientRect()
    return {
      minX: dragStartX + (containerRect.left - elementRect.left),
      maxX: dragStartX + (containerRect.right - elementRect.right),
      minY: dragStartY + (containerRect.top - elementRect.top),
      maxY: dragStartY + (containerRect.bottom - elementRect.bottom),
    }
  }

  // Numeric form. Missing keys → unbounded on that side.
  const numeric = constraints as { top?: number; left?: number; right?: number; bottom?: number }
  return {
    minX: numeric.left ?? -Infinity,
    maxX: numeric.right ?? Infinity,
    minY: numeric.top ?? -Infinity,
    maxY: numeric.bottom ?? Infinity,
  }
}

/**
 * Apply elastic resistance past a boundary (Q15c — linear).
 *
 * Within bounds: `value` passes through unchanged. Past a bound by `Δ`: the
 * displayed value is `boundary + elastic × Δ`. With `elastic: 0` the value
 * clamps hard at the boundary; with `elastic: 1` resistance vanishes
 * (motion's default is `0.5`, halving the overflow).
 *
 * The function is symmetric — overflow on either side resists with the
 * same coefficient.
 */
function applyElastic(value: number, min: number, max: number, elastic: number): number {
  if (value < min) return min + (value - min) * elastic
  if (value > max) return max + (value - max) * elastic
  return value
}

const DEFAULT_ELASTIC = 0.5

/**
 * Default `dragTransition` (Q15d — matches motion's inertia preset).
 *
 * `type: "inertia"` decays from the release point using `velocity`, with
 * spring physics at `min`/`max` boundaries. The defaults are the values
 * the user signed off on during Phase 2 grilling; passing a custom
 * `dragTransition` shallow-merges over these.
 */
const DEFAULT_DRAG_TRANSITION = {
  type: "inertia" as const,
  power: 0.8,
  timeConstant: 750,
  bounceStiffness: 500,
  bounceDamping: 10,
  restDelta: 1,
  restSpeed: 10,
}

/**
 * Bind pointer-driven drag to an element. Layers on top of createPan for the
 * pointer session; adds transform writes, body styles, pointer capture, and
 * state-machine activation.
 *
 * Drag is enabled when `opts.drag` is truthy (`true`, `"x"`, or `"y"`).
 * createDrag always wires the pointer session — the enable check is per-
 * gesture-start, so toggling `opts.drag` on/off doesn't churn listeners.
 *
 * Phase 2 Commit 6 — Stage 2 scope: VE bootstrap, translation, axis lock,
 * body/pointer styles, callbacks, cleanup. Constraints + elastic resistance
 * land in Stage 3; momentum + dragSnapToOrigin in Stage 4.
 */
export function createDrag(
  el: HTMLElement,
  getOpts: () => MotionOptions,
  setActive: SetActive,
): void {
  // Drag-session state. These are reset on each pan-start; null between
  // sessions. Holding references in the closure is fine — the createPan
  // handlers below close over them.
  let xMV: MotionValue<number> | null = null
  let yMV: MotionValue<number> | null = null
  /** Drag-start position of the x/y MotionValues (the values that existed
   * before the user grabbed). offsets from PanInfo accumulate from this. */
  let dragStartX = 0
  let dragStartY = 0
  /** Resolved bounds for this session — computed once at drag-start and
   * reused across all pointermoves to avoid repeat layout reads. `null`
   * means no constraints. */
  let sessionBounds: ResolvedBounds | null = null
  /** Saved before applying drag's `user-select` / `touch-action` overrides
   * so we can restore them exactly on session end. */
  let savedUserSelect = ""
  let savedTouchAction = ""
  let capturedPointerId: number | null = null
  /** In-flight momentum animations (one per axis when active). Stopped on
   * owner disposal AND on a fresh pointerdown (to interrupt a settling
   * momentum if the user grabs again mid-decay). */
  let momentumControls: AnimationPlaybackControls[] = []

  function isDragEnabled(): boolean {
    return Boolean(getOpts().drag)
  }

  function restoreBodyAndElementStyles(): void {
    document.body.style.userSelect = savedUserSelect
    el.style.touchAction = savedTouchAction
  }

  function releasePointerCaptureSafely(): void {
    if (capturedPointerId === null) return
    try {
      el.releasePointerCapture(capturedPointerId)
    } catch {
      // jsdom doesn't fully implement setPointerCapture; tolerate.
    }
    capturedPointerId = null
  }

  function stopMomentum(): void {
    for (const ctrl of momentumControls) ctrl.stop()
    momentumControls = []
  }

  // Stable handler references — they close over getOpts so reactive opts
  // are read at event time. Hoisted out of the createPan call so the
  // function-form options below doesn't re-allocate them per getOpts() call.
  const handlePanStart = (event: PointerEvent, info: PanInfo, mvIsAuthoritative = false) => {
    // The pan session always fires onPanStart once movement crosses the
    // threshold. Drag's enable check is here, not at the createPan-setup
    // site, so toggling `drag` off mid-life immediately stops drag
    // engagement without re-attaching pointer listeners.
    if (!isDragEnabled()) return

    // If momentum from a previous drag is still settling, cancel it now —
    // the user has grabbed again, and they expect the element to follow
    // their pointer from its current position, not continue decaying.
    stopMomentum()

    const ve = ensureVisualElement(el)
    xMV = ve.getValue("x", 0) as MotionValue<number>
    yMV = ve.getValue("y", 0) as MotionValue<number>

    // dragStart capture — two modes:
    //
    // (1) Default: sync the MV to the element's CURRENT visible translate
    //     before capturing. motion's `animate(el, target)` interpolates
    //     `style.transform` via WAAPI but DOESN'T update the
    //     visualElement's x/y MVs in lockstep, so after an entrance
    //     animation (e.g. `initial: {x:-300} → animate: {x:0}`) the MV
    //     would still hold the start value. Reading the painted transform
    //     recovers the truth and seeds dragStart correctly.
    //
    // (2) `mvIsAuthoritative=true` (e.g. dragControls.start with
    //     snapToCursor): the caller wrote the MV synchronously RIGHT
    //     before reaching us, but motion-dom's writer is frame-scheduled,
    //     so `el.style.transform` may not reflect that write yet. Trust
    //     the MV in this path — visible would be stale.
    //
    // Only the axis drag actually uses is touched — touching the locked
    // axis would generate spurious MV writes that callers + tests notice.
    const axis = getOpts().drag
    if (mvIsAuthoritative) {
      dragStartX = xMV.get()
      dragStartY = yMV.get()
    } else {
      const visible = readVisibleTranslate(el)
      if (axis !== "y") {
        if (visible.x !== xMV.get()) xMV.set(visible.x)
        dragStartX = visible.x
      } else {
        dragStartX = xMV.get()
      }
      if (axis !== "x") {
        if (visible.y !== yMV.get()) yMV.set(visible.y)
        dragStartY = visible.y
      } else {
        dragStartY = yMV.get()
      }
    }

    // Resolve constraints once per session. Reading layout rects mid-drag
    // would cost a forced reflow per pointermove; one read at drag-start
    // is enough for v0.1 (reactive constraint changes during a drag are
    // a rare corner case — they re-apply on the NEXT session).
    sessionBounds = resolveConstraints(getOpts().dragConstraints, el, dragStartX, dragStartY)

    // Body + touch-action overrides — saved so the exact prior values
    // restore on session end (don't assume defaults).
    savedUserSelect = document.body.style.userSelect
    savedTouchAction = el.style.touchAction
    document.body.style.userSelect = "none"
    el.style.touchAction = touchActionFor(getOpts().drag)

    // Pointer capture keeps move events flowing to the element even when
    // the pointer leaves it during a fast drag. setPointerCapture can
    // throw in some browsers (e.g., already captured); swallow.
    try {
      el.setPointerCapture(event.pointerId)
      capturedPointerId = event.pointerId
    } catch {
      // Safe — window listeners in createPan continue to fire regardless.
    }

    setActive("whileDrag", true)
    getOpts().onDragStart?.(event, info)
  }

  const handlePan = (event: PointerEvent, info: PanInfo) => {
    if (!isDragEnabled() || !xMV || !yMV) return

    const axis = getOpts().drag
    // Axis lock: when drag is "x" or "y", we SKIP writes to the locked axis
    // entirely — matches motion/react's per-axis shouldDrag short-circuit.
    // Writing dragStartY+0 to yMV when y is locked would generate
    // no-op-but-non-empty writes that consumers and tests both observe.
    const writeX = axis !== "y"
    const writeY = axis !== "x"
    const elastic = getOpts().dragElastic ?? DEFAULT_ELASTIC

    if (writeX) {
      const candidateX = dragStartX + info.offset.x
      const finalX = sessionBounds
        ? applyElastic(candidateX, sessionBounds.minX, sessionBounds.maxX, elastic)
        : candidateX
      xMV.set(finalX)
    }
    if (writeY) {
      const candidateY = dragStartY + info.offset.y
      const finalY = sessionBounds
        ? applyElastic(candidateY, sessionBounds.minY, sessionBounds.maxY, elastic)
        : candidateY
      yMV.set(finalY)
    }

    getOpts().onDrag?.(event, info)
  }

  const handlePanEnd = (event: PointerEvent, info: PanInfo) => {
    if (!isDragEnabled() || !xMV || !yMV) return

    // Visual gesture state ends with the pointerup; momentum is a separate
    // animation that continues after whileDrag deactivates. This matches
    // motion/react semantic: `whileDrag: { scale: 1.05 }` un-scales at
    // release, while the position settles independently.
    setActive("whileDrag", false)
    restoreBodyAndElementStyles()
    releasePointerCaptureSafely()

    // The user's `onDragEnd` callback fires at the END of this function
    // (just before the early-out), not here. Rationale: a synchronous
    // state flip from the callback (e.g. closing a Dialog whose contents
    // are this draggable) used to race motion's own post-callback work
    // — momentum dispatch, MV-ref cleanup — and could wedge surrounding
    // libraries that observe the same DOM (scroll lock, pointer-event
    // layers). Firing AFTER all motion DOM-touching work guarantees a
    // clean handoff: by the time the callback runs, the drag session is
    // fully torn down and any subsequent reactive cascade is unambiguous
    // about ownership.

    // Capture refs locally — the closure clears xMV/yMV below before the
    // momentum promise can resolve, but the inertia animation needs stable
    // references through its lifetime.
    const xRef = xMV
    const yRef = yMV
    const boundsRef = sessionBounds
    const opts = getOpts()
    const snapToOrigin = opts.dragSnapToOrigin ?? false
    const momentum = opts.dragMomentum ?? true
    const userTransition = opts.dragTransition ?? {}

    // Axis lock: the release path must mirror the same write-gate the drag
    // loop uses (handlePan). Without this, pointer velocity on the locked
    // axis feeds an inertia animation on that axis's MV — drifting the
    // element along an axis the user explicitly locked. The cursor still
    // has Y velocity when `drag: "x"` (any non-perfectly-horizontal motion
    // moves the pointer through Y), so this matters in practice.
    const dragAxis = opts.drag
    const releaseX = dragAxis !== "y"
    const releaseY = dragAxis !== "x"

    // Reset the tracked momentum array — we'll push 1 or 2 controls below
    // depending on axis. (handlePanStart's stopMomentum already cleared any
    // prior session's controls, but we re-initialize here for clarity since
    // the per-axis branches below append rather than replace.)
    momentumControls = []

    // Q15c follow-up: couple bounce physics to `dragElastic`. With elastic
    // 0 (hard clamp), inertia's spring-back at the boundary uses default
    // stiffness/damping that visibly overshoots before settling — even
    // though the drag itself is clamped. Mirror motion-react's pattern
    // (VisualElementDragControls.startAnimation): overdamp the spring with
    // very high stiffness + damping so the snap-back is effectively
    // instantaneous. With elastic > 0 we keep the soft spring so the
    // rubber-band feel is preserved.
    //
    // Numerical choices (200/40 soft, 1e6/1e7 hard) come from motion-react.
    const elastic = opts.dragElastic ?? DEFAULT_ELASTIC
    const bounceParams = elastic
      ? { bounceStiffness: 200, bounceDamping: 40 }
      : { bounceStiffness: 1_000_000, bounceDamping: 10_000_000 }

    // Flicker fix for elastic=0: motion-react's source acknowledges that
    // overdamping the spring still computes one frame of overshoot before
    // the snap-back. When the user releases AT a boundary with velocity
    // pointing OUT of that boundary, there's nothing for inertia to
    // usefully decay toward — feeding it the outward velocity produces
    // exactly the visible flicker. Zero those release velocities and
    // inertia settles silently at the bound. Inward velocities are
    // preserved so a release moving back toward center still glides.
    const xAtMax = boundsRef !== null && boundsRef.maxX !== Infinity && xRef.get() >= boundsRef.maxX
    const xAtMin =
      boundsRef !== null && boundsRef.minX !== -Infinity && xRef.get() <= boundsRef.minX
    const yAtMax = boundsRef !== null && boundsRef.maxY !== Infinity && yRef.get() >= boundsRef.maxY
    const yAtMin =
      boundsRef !== null && boundsRef.minY !== -Infinity && yRef.get() <= boundsRef.minY
    const xVelocity =
      !elastic && ((xAtMax && info.velocity.x > 0) || (xAtMin && info.velocity.x < 0))
        ? 0
        : info.velocity.x
    const yVelocity =
      !elastic && ((yAtMax && info.velocity.y > 0) || (yAtMin && info.velocity.y < 0))
        ? 0
        : info.velocity.y

    /** Fire onDragTransitionEnd via getOpts so reactive callback swaps see
     * the latest value (the user may have swapped handlers between pan-end
     * and momentum-settle). */
    const fireTransitionEnd = () => getOpts().onDragTransitionEnd?.()

    if (snapToOrigin) {
      // Spring back to (0, 0). motion's pattern (Q15e): use the inertia
      // transition but clamp min/max to 0 so the spring physics carries
      // the value home from wherever the user released it.
      const transitionX = {
        ...DEFAULT_DRAG_TRANSITION,
        ...bounceParams,
        ...userTransition,
        velocity: xVelocity,
        min: 0,
        max: 0,
      }
      const transitionY = {
        ...DEFAULT_DRAG_TRANSITION,
        ...bounceParams,
        ...userTransition,
        velocity: yVelocity,
        min: 0,
        max: 0,
      }
      const settles: Array<Promise<unknown> | AnimationPlaybackControls> = []
      if (releaseX) {
        // biome-ignore lint/suspicious/noExplicitAny: motion's animate has a complex overloaded shape; the runtime call is correct. Target arg is a placeholder — inertia computes the actual settle point from velocity + min/max.
        const ctrlX = animate(xRef, 0, transitionX as any)
        momentumControls.push(ctrlX)
        settles.push(ctrlX)
      }
      if (releaseY) {
        // biome-ignore lint/suspicious/noExplicitAny: motion's animate has a complex overloaded shape; the runtime call is correct.
        const ctrlY = animate(yRef, 0, transitionY as any)
        momentumControls.push(ctrlY)
        settles.push(ctrlY)
      }
      if (settles.length > 0) Promise.all(settles).then(fireTransitionEnd)
      else fireTransitionEnd()
    } else {
      // Inertia release path — runs regardless of `dragMomentum`. When
      // momentum is true, we feed the (heuristic-clamped) release velocity
      // so the element glides naturally. When momentum is false, we feed
      // velocity 0 — there's no decay, but the bounce physics still spring
      // the element back to the bound if elastic let it overshoot during
      // the drag. Skipping the animate entirely (the prior behavior) left
      // the user stranded outside the container with no way to reach the
      // element. Matches motion-react's pattern (VisualElementDragControls
      // .startAnimation always runs inertia, zeroing velocity when
      // dragMomentum is false).
      const releaseVelocityX = momentum ? xVelocity : 0
      const releaseVelocityY = momentum ? yVelocity : 0
      const transitionX = {
        ...DEFAULT_DRAG_TRANSITION,
        ...bounceParams,
        ...userTransition,
        velocity: releaseVelocityX,
        min: boundsRef?.minX,
        max: boundsRef?.maxX,
      }
      const transitionY = {
        ...DEFAULT_DRAG_TRANSITION,
        ...bounceParams,
        ...userTransition,
        velocity: releaseVelocityY,
        min: boundsRef?.minY,
        max: boundsRef?.maxY,
      }
      const settles: Array<Promise<unknown> | AnimationPlaybackControls> = []
      if (releaseX) {
        // biome-ignore lint/suspicious/noExplicitAny: motion's animate has a complex overloaded shape; the runtime call is correct.
        const ctrlX = animate(xRef, 0, transitionX as any)
        momentumControls.push(ctrlX)
        settles.push(ctrlX)
      }
      if (releaseY) {
        // biome-ignore lint/suspicious/noExplicitAny: motion's animate has a complex overloaded shape; the runtime call is correct.
        const ctrlY = animate(yRef, 0, transitionY as any)
        momentumControls.push(ctrlY)
        settles.push(ctrlY)
      }
      if (settles.length > 0) Promise.all(settles).then(fireTransitionEnd)
      else fireTransitionEnd()
    }

    xMV = null
    yMV = null
    sessionBounds = null

    // Callback fires last — see the note at the top of handlePanEnd.
    getOpts().onDragEnd?.(event, info)
  }

  // Function-form options so createPan reads `panThreshold` reactively.
  // Handler references are stable — only the threshold (and the wrapping
  // object) is recreated per call from createPan.
  createPan(
    () => el,
    () => ({
      threshold: getOpts().panThreshold,
      onPanStart: handlePanStart,
      onPan: handlePan,
      onPanEnd: handlePanEnd,
    }),
  )

  // ---------- External drag (Q9 — createDragControls integration) ----------
  // When the user wires `dragControls: someControls` into MotionOptions, an
  // external pointerdown elsewhere in the UI (a "drag handle" button) can
  // start a drag on this element via `controls.start(event)`. Bypasses the
  // threshold gate — the user explicitly said "drag," no hysteresis needed.
  //
  // We synthesize our own pan session here rather than re-using createPan's
  // because:
  //   1. The originating element is the drag handle, not `el`. createPan's
  //      pointerdown listener is bound to `el` and wouldn't see the event.
  //   2. We need to skip threshold; createPan's threshold gate is private.
  //
  // The session-tracking logic (pointerId match, sample buffer for velocity,
  // window listener attach/cleanup) is duplicated from createPan. A future
  // refactor could extract a shared "pan session runner" if a third caller
  // emerges; for v0.1 the duplication is contained.
  function startExternalDrag(event: PointerEvent, options: DragControlsStartOptions): void {
    if (!isDragEnabled()) return

    // Snap-to-cursor (Q9b): move the element so its center sits under the
    // pointer BEFORE the drag-start info captures dragStartX/Y. Otherwise
    // the offset chain would start from the original position and the
    // visible jump-to-cursor would be lost on first pointermove.
    if (options.snapToCursor) {
      const ve = ensureVisualElement(el)
      const snapXMV = ve.getValue("x", 0) as MotionValue<number>
      const snapYMV = ve.getValue("y", 0) as MotionValue<number>
      const elRect = el.getBoundingClientRect()
      const centerX = elRect.left + elRect.width / 2
      const centerY = elRect.top + elRect.height / 2
      const axis = getOpts().drag
      if (axis !== "y") snapXMV.set(snapXMV.get() + (event.clientX - centerX))
      if (axis !== "x") snapYMV.set(snapYMV.get() + (event.clientY - centerY))
    }

    // Fire handlePanStart with a synthesized initial PanInfo. This
    // initializes xMV/yMV/dragStartX/Y, resolves bounds, sets body styles,
    // captures pointer, activates whileDrag, and fires onDragStart.
    //
    // `mvIsAuthoritative=true` when the snap path just wrote the MVs
    // above — handlePanStart should read FROM the MV (not from
    // getComputedStyle) because motion-dom's writer is frame-scheduled
    // and `el.style.transform` may not yet reflect the snap write.
    const initialInfo: PanInfo = {
      point: { x: event.clientX, y: event.clientY },
      delta: { x: 0, y: 0 },
      offset: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
    }
    handlePanStart(event, initialInfo, Boolean(options.snapToCursor))

    // Track the session locally — these would normally live inside
    // createPan's closure. Velocity samples use motion-dom's `time.now()`
    // to stay frame-synchronous with the rest of the pipeline.
    const sessionStartPoint = { x: event.clientX, y: event.clientY }
    let sessionLastPoint = { ...sessionStartPoint }
    const sessionPointerId = event.pointerId
    const sessionSamples: Array<{ t: number; point: { x: number; y: number } }> = [
      { t: time.now(), point: { ...sessionStartPoint } },
    ]

    function computeSessionVelocity(): { x: number; y: number } {
      if (sessionSamples.length < 2) return { x: 0, y: 0 }
      const first = sessionSamples[0]
      const last = sessionSamples[sessionSamples.length - 1]
      if (!first || !last) return { x: 0, y: 0 }
      const dt = last.t - first.t
      if (dt <= 0) return { x: 0, y: 0 }
      return {
        x: ((last.point.x - first.point.x) / dt) * 1000,
        y: ((last.point.y - first.point.y) / dt) * 1000,
      }
    }

    function buildSessionInfo(e: PointerEvent): PanInfo {
      const point = { x: e.clientX, y: e.clientY }
      return {
        point,
        delta: { x: point.x - sessionLastPoint.x, y: point.y - sessionLastPoint.y },
        offset: { x: point.x - sessionStartPoint.x, y: point.y - sessionStartPoint.y },
        velocity: computeSessionVelocity(),
      }
    }

    function onSessionMove(e: PointerEvent): void {
      if (e.pointerId !== sessionPointerId) return
      const point = { x: e.clientX, y: e.clientY }
      const now = time.now()
      sessionSamples.push({ t: now, point })
      const cutoff = now - 200
      while (sessionSamples.length > 1 && (sessionSamples[0]?.t ?? 0) < cutoff) {
        sessionSamples.shift()
      }
      const info = buildSessionInfo(e)
      sessionLastPoint = point
      handlePan(e, info)
    }

    function onSessionEnd(e: PointerEvent): void {
      if (e.pointerId !== sessionPointerId) return
      const info = buildSessionInfo(e)
      handlePanEnd(e, info)
      window.removeEventListener("pointermove", onSessionMove)
      window.removeEventListener("pointerup", onSessionEnd)
      window.removeEventListener("pointercancel", onSessionEnd)
    }

    window.addEventListener("pointermove", onSessionMove)
    window.addEventListener("pointerup", onSessionEnd)
    window.addEventListener("pointercancel", onSessionEnd)
  }

  // Register with the controls instance whenever opts.dragControls changes.
  // createEffect re-runs on swap; the previous registration unmounts via
  // the symbol-keyed unregister function. Q9d — last mount wins; the
  // unregister only nulls out if we're still the active handler.
  createEffect(() => {
    const controls = getOpts().dragControls as DragControls | undefined
    if (!controls) return
    const internal = controls as DragControls & {
      [DRAG_CONTROLS_REGISTER]?: (
        handler: (event: PointerEvent, options: DragControlsStartOptions) => void,
      ) => () => void
    }
    const register = internal[DRAG_CONTROLS_REGISTER]
    if (!register) return
    const unregister = register(startExternalDrag)
    onCleanup(unregister)
  })

  // Owner-disposal cleanup. Three layers:
  // 1. Stop any settling momentum animations (they hold MV references that
  //    keep ticking after disposal otherwise).
  // 2. Restore the body/touch styles if we're in mid-drag.
  // 3. Release any captured pointer.
  // createPan's own onCleanup handles removing its listeners separately.
  onCleanup(() => {
    stopMomentum()
    if (xMV || yMV) {
      restoreBodyAndElementStyles()
      releasePointerCaptureSafely()
    }
  })
}
