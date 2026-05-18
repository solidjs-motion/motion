import { type AnimationPlaybackControls, animate } from "motion"
import { HTMLVisualElement, type MotionValue, visualElementStore } from "motion-dom"
import { onCleanup } from "solid-js"
import type { DragConstraints, MotionOptions, PanInfo } from "../types"
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
  const handlePanStart = (event: PointerEvent, info: PanInfo) => {
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
    dragStartX = xMV.get()
    dragStartY = yMV.get()

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

    getOpts().onDragEnd?.(event, info)

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
        ...userTransition,
        velocity: info.velocity.x,
        min: 0,
        max: 0,
      }
      const transitionY = {
        ...DEFAULT_DRAG_TRANSITION,
        ...userTransition,
        velocity: info.velocity.y,
        min: 0,
        max: 0,
      }
      // biome-ignore lint/suspicious/noExplicitAny: motion's animate has a complex overloaded shape; the runtime call is correct. Target arg is a placeholder — inertia computes the actual settle point from velocity + min/max.
      const ctrlX = animate(xRef, 0, transitionX as any)
      // biome-ignore lint/suspicious/noExplicitAny: motion's animate has a complex overloaded shape; the runtime call is correct.
      const ctrlY = animate(yRef, 0, transitionY as any)
      momentumControls = [ctrlX, ctrlY]
      Promise.all([ctrlX, ctrlY]).then(fireTransitionEnd)
    } else if (momentum) {
      // Inertia decay from current position with release velocity. Bounds
      // (computed at drag-start in resolveConstraints) clamp the settle
      // point; bounceStiffness/bounceDamping give the spring physics if
      // the decay would exit the bounds.
      const transitionX = {
        ...DEFAULT_DRAG_TRANSITION,
        ...userTransition,
        velocity: info.velocity.x,
        min: boundsRef?.minX,
        max: boundsRef?.maxX,
      }
      const transitionY = {
        ...DEFAULT_DRAG_TRANSITION,
        ...userTransition,
        velocity: info.velocity.y,
        min: boundsRef?.minY,
        max: boundsRef?.maxY,
      }
      // biome-ignore lint/suspicious/noExplicitAny: motion's animate has a complex overloaded shape; the runtime call is correct.
      const ctrlX = animate(xRef, 0, transitionX as any)
      // biome-ignore lint/suspicious/noExplicitAny: motion's animate has a complex overloaded shape; the runtime call is correct.
      const ctrlY = animate(yRef, 0, transitionY as any)
      momentumControls = [ctrlX, ctrlY]
      Promise.all([ctrlX, ctrlY]).then(fireTransitionEnd)
    } else {
      // No momentum, no snap — stay at release position (Q15e). Fire the
      // transitionEnd hook synchronously so consumers can chain reliably.
      fireTransitionEnd()
    }

    xMV = null
    yMV = null
    sessionBounds = null
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
