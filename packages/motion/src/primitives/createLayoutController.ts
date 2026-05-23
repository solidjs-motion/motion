// ---------------------------------------------------------------------------
// createLayoutController — per-element FLIP machinery.
//
// Subscribes to layout-relevant triggers (step 7: layoutDependency +
// LayoutGroup.broadcast; step 8 adds RO(self) + parent MO). On a trigger,
// schedules a measurement via motion-dom's `frame.read`, computes the
// projection-parent-local delta + inverse scale (ADR 0007), and animates
// the registry's layout layer (ADR 0006) from inverse → identity via
// `frame.write`. The writer's value-layer fold (step 3) composes the
// layer MVs with any user-facing transform keys into a single
// `el.style.transform`.
//
// Out of scope for step 7 (deferred to the indicated step):
//
// - ResizeObserver(self) + parent MO triggers           → step 8
// - ProjectionContext push from layout-active elements  → step 10
// - layoutRoot / layoutScroll / layoutAnchor semantics  → steps 11–13
// - layoutId donate / consume                           → step 14
// - onLayoutAnimationStart / onLayoutAnimationComplete  → step 18
// - Reactive layout-toggle (Q8/risk #4)                 → its own polish step
//
// `opts.layout` is snapshotted at construction; users who want to toggle
// layout off/on remount the element via a key change. The reactive
// toggle is its own polish step.
// ---------------------------------------------------------------------------

import { animate, type MotionValue, motionValue } from "motion"
import { frame } from "motion-dom"
import { type Accessor, createEffect, onCleanup, untrack } from "solid-js"
import { shouldReduceMotion } from "../reduced-motion"
import type {
  LayoutGroupContextValue,
  MotionConfigContextValue,
  MotionElement,
  MotionOptions,
  ProjectionContextValue,
  Transition,
} from "../types"
import { mergeTransition } from "./createMotion"
import type { LayoutAxis, ValueRegistry } from "./value-registry"

export type CreateLayoutControllerConfig = {
  /** Registry to install layout-layer MVs into. */
  registry: ValueRegistry
  /**
   * Callback invoked when the layer's shape changes (axis added /
   * cleared). Lets `createMotion`'s `refreshWriter` recompile the
   * writer closure to include the multi-key path that runs the fold.
   */
  refreshWriter: () => void
  /**
   * The writer's "compose el.style.transform from the registry"
   * function. Subscribed to each layer MV's `change` event so
   * `animate()`-driven updates flow through the same recompose path
   * as user-facing style MVs.
   */
  writeFromRegistry: () => void
  /** Context value carrying projection ancestry (see ADR 0007). */
  projectionContext: ProjectionContextValue
  /** Context value carrying the per-group coordinator + broadcast. */
  layoutGroupContext: LayoutGroupContextValue
  /** MotionConfig accessor pair (transition default + reducedMotion mode). */
  motionConfig: MotionConfigContextValue
  /** System-pref accessor (`prefers-reduced-motion: reduce`). */
  systemReducedMotion: Accessor<boolean>
}

/** Projection-parent-local rect (ADR 0007). */
type LocalRect = { x: number; y: number; width: number; height: number }

/**
 * Per-element FLIP controller. Constructed once per layout-active
 * element by `createMotion` when `untrack(getOpts).layout` is truthy.
 * Lifecycle ties to the surrounding Solid owner — `onCleanup` clears
 * the layer and refreshes the writer.
 */
export function createLayoutController(
  el: MotionElement,
  getOpts: () => MotionOptions,
  config: CreateLayoutControllerConfig,
): void {
  const {
    registry,
    refreshWriter,
    writeFromRegistry,
    projectionContext,
    layoutGroupContext,
    motionConfig,
    systemReducedMotion,
  } = config

  // First-rect cache. Undefined until the baseline measurement runs.
  // After each successful FLIP, `first` is updated to the post-FLIP
  // `last` so subsequent triggers measure against the most recent
  // settled position.
  let first: LocalRect | undefined
  let measurementScheduled = false
  // Liveness flag — set false on owner cleanup. Frame-scheduled
  // callbacks check this before touching the registry; lets us drop
  // pending reads/writes without explicit `cancelFrame` plumbing.
  let live = true

  // Lazily-allocated layer MVs (one per axis). Created on first FLIP
  // that needs them; persisted across subsequent FLIPs (the same MV is
  // re-animated, preserving the visual-position invariant during
  // interruption — locked Q8 semantics).
  const layerMVs: Partial<Record<LayoutAxis, MotionValue<number>>> = {}

  function measureLocal(): LocalRect | undefined {
    const parentEl = projectionContext.parentEl()
    if (!parentEl) return undefined
    const E = el.getBoundingClientRect()
    const P = parentEl.getBoundingClientRect()
    return {
      x: E.left - P.left,
      y: E.top - P.top,
      width: E.width,
      height: E.height,
    }
  }

  function scheduleMeasurement(): void {
    if (measurementScheduled) return
    measurementScheduled = true
    frame.read(() => {
      measurementScheduled = false
      if (!live) return
      runMeasurement()
    })
  }

  function runMeasurement(): void {
    const last = measureLocal()
    if (!last) return

    // Baseline-establishing pass. No animation fires; subsequent
    // measurements compare to this snapshot.
    if (first === undefined) {
      first = last
      return
    }

    const deltaX = first.x - last.x
    const deltaY = first.y - last.y
    // Guard against degenerate rects (width/height === 0 — possible
    // when an element is detached or display:none mid-transition).
    // Division by zero would produce Infinity; treat as identity scale.
    const inverseScaleX = last.width === 0 ? 1 : first.width / last.width
    const inverseScaleY = last.height === 0 ? 1 : first.height / last.height

    // First===Last de-dupe. Trigger fired but no actual movement.
    if (deltaX === 0 && deltaY === 0 && inverseScaleX === 1 && inverseScaleY === 1) {
      first = last
      return
    }

    const opts = untrack(getOpts)
    const mode = opts.layout
    if (!mode) {
      first = last
      return
    }

    applyFlip(deltaX, deltaY, inverseScaleX, inverseScaleY, mode, opts)
    first = last
  }

  function applyFlip(
    deltaX: number,
    deltaY: number,
    invScaleX: number,
    invScaleY: number,
    mode: NonNullable<MotionOptions["layout"]>,
    opts: MotionOptions,
  ): void {
    const animatePos = mode === true || mode === "position" || mode === "preserve-aspect"
    const animateSize = mode === true || mode === "size" || mode === "preserve-aspect"

    // preserve-aspect: uniform scale tucks the element inside its source
    // footprint at t=0 (locked Q10 — `Math.min(invScaleX, invScaleY)`).
    let sx = invScaleX
    let sy = invScaleY
    if (mode === "preserve-aspect") {
      const s = Math.min(invScaleX, invScaleY)
      sx = s
      sy = s
    }

    const reduced = shouldReduceMotion(motionConfig.reducedMotion(), systemReducedMotion())
    const transition = mergeTransition(
      motionConfig.transition(),
      opts.transition,
      opts.layoutTransition,
      reduced,
    )

    // Inverse application + animate() calls happen synchronously after
    // the `frame.read` measurement returns. Motion-dom's `animate()`
    // handles its own read/write phasing internally for the actual
    // DOM mutations — calling it from outside a frame step is the
    // canonical pattern (cf. framer-motion's layout module).
    if (animatePos && (deltaX !== 0 || deltaY !== 0)) {
      const xMV = ensureLayerMV("x", 0)
      const yMV = ensureLayerMV("y", 0)
      xMV.set(deltaX)
      yMV.set(deltaY)
      runAnimation(xMV, 0, transition)
      runAnimation(yMV, 0, transition)
    }
    if (animateSize && (sx !== 1 || sy !== 1)) {
      const sxMV = ensureLayerMV("scaleX", 1)
      const syMV = ensureLayerMV("scaleY", 1)
      sxMV.set(sx)
      syMV.set(sy)
      runAnimation(sxMV, 1, transition)
      runAnimation(syMV, 1, transition)
    }
  }

  function ensureLayerMV(axis: LayoutAxis, identity: number): MotionValue<number> {
    const existing = layerMVs[axis]
    if (existing !== undefined) return existing
    const mv = motionValue<number>(identity)
    layerMVs[axis] = mv
    registry.setLayoutValue(axis, mv)
    // Subscribe the writer to this layer MV so `set()` calls and
    // `animate()`-driven updates flow through the same recompose path
    // as user-facing style MVs. `onCleanup` ties the unsubscribe to
    // the surrounding owner.
    onCleanup(mv.on("change", writeFromRegistry))
    // Layer-shape change → recompile writer so the multi-key fold path
    // runs (single-key fast path bypasses the fold; see refreshWriter
    // in createMotion).
    refreshWriter()
    return mv
  }

  function runAnimation(mv: MotionValue<number>, target: number, transition: Transition): void {
    // biome-ignore lint/suspicious/noExplicitAny: motion's animate has an overloaded shape; the MV+number form is the runtime path we want.
    animate(mv as any, target, transition as any)
  }

  // ---------- Trigger subscriptions ----------
  // Each createEffect's first iteration provides the baseline-
  // establishing measurement (first === undefined → no animation fires
  // from the baseline pass). Subsequent iterations re-fire
  // scheduleMeasurement on every dependency change. The two effects
  // coalesce via scheduleMeasurement's `measurementScheduled` guard so
  // multiple triggers within a frame produce a single measurement.

  // layoutDependency (per-element).
  createEffect(() => {
    const dep = getOpts().layoutDependency
    // Subscribe inside the effect's tracking scope. Empty / undefined
    // dep still triggers a baseline measurement on first iteration.
    if (dep) dep()
    scheduleMeasurement()
  })

  // LayoutGroup.broadcast (group-wide).
  createEffect(() => {
    layoutGroupContext.broadcast()
    scheduleMeasurement()
  })

  onCleanup(() => {
    live = false
    registry.clearLayoutLayer()
    refreshWriter()
  })
}
