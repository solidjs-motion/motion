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

// ---------------------------------------------------------------------------
// Shared parent-MutationObserver cache
//
// Each layout element subscribes to mutations on its IMMEDIATE PARENT. With
// N siblings (e.g., 1000-item list), naïvely allocating N observers on the
// same parent is wasteful. This module-level WeakMap shares ONE observer
// per parent; subscribers register callbacks that all fire on any matching
// mutation, and the last unsubscriber disconnects the observer.
//
// Mutation filter (locked Q4 grill):
//   - `childList: true` — sibling reorder / insert / delete.
//   - `attributes: true` with `attributeFilter: ["style", "class"]` — parent
//     restyles (e.g., `alignItems: open() ? "flex-start" : "flex-end"`) that
//     reposition descendants without resizing them. RO(self) does not catch
//     these because the descendant's own box dimensions don't change.
//
// False-positive notifications (parent mutated transform-only mid-FLIP, or
// the descendant's local-coord rect is unchanged) de-dupe at the measurement
// layer via `First === Last`.
// ---------------------------------------------------------------------------

type ParentMoEntry = {
  observer: MutationObserver
  subscribers: Set<() => void>
}

const parentMoCache = new WeakMap<Element, ParentMoEntry>()

function subscribeParentMo(parent: Element, onChange: () => void): () => void {
  let entry = parentMoCache.get(parent)
  if (entry === undefined) {
    const subscribers = new Set<() => void>()
    const observer = new MutationObserver(() => {
      // Each subscriber's onChange is the controller's
      // scheduleMeasurement(), which is idempotent per frame; multiple-
      // subscriber dispatch within a single MO firing is safe.
      for (const sub of subscribers) sub()
    })
    observer.observe(parent, {
      childList: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    })
    entry = { observer, subscribers }
    parentMoCache.set(parent, entry)
  }
  const captured = entry
  captured.subscribers.add(onChange)
  return () => {
    captured.subscribers.delete(onChange)
    if (captured.subscribers.size === 0) {
      captured.observer.disconnect()
      // Only delete from the cache if this entry is still the current
      // one. If a new subscriber registered after this entry hit zero
      // (rare; would require a same-microtask re-subscribe), it would
      // create a NEW entry — don't clobber it.
      if (parentMoCache.get(parent) === captured) {
        parentMoCache.delete(parent)
      }
    }
  }
}

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
  /**
   * Pre-set First rect (the layoutId handoff case). When provided,
   * the controller's initial measurement computes a DELTA from this
   * value rather than establishing baseline — the first FLIP fires
   * immediately, animating from the donor's position to the
   * consumer's natural position.
   */
  initialFirst?: { x: number; y: number; width: number; height: number }
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
    initialFirst,
  } = config

  // First-rect cache. Undefined until the baseline measurement runs,
  // unless `config.initialFirst` is provided (layoutId handoff): then
  // it's seeded with the donor's rect at construction so the first
  // measurement computes a DELTA — FLIP fires from donor's position
  // to consumer's natural position.
  let first: LocalRect | undefined = initialFirst
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
    // Subtract our OWN layer transform to recover the LAYOUT rect
    // (pre-our-transform). Browser's `getBoundingClientRect` reports
    // the rendered (transformed) box — without this subtraction,
    // a re-measurement triggered by RO firing AFTER we wrote a layer
    // transform would read the transformed bcr and compute a delta
    // against itself, producing a feedback loop (each measurement
    // ratchets the layer toward infinity). Subtracting recovers the
    // invariant layout rect so `First === Last` de-dupes spurious
    // re-measurements during our own animation.
    //
    // Parent's transform (if parent is also layout-active) cancels
    // automatically via `E - P` math: both rects shift equally in
    // viewport coords when an ancestor transform applies, so the
    // difference is parent-relative LAYOUT.
    const layerX = layerMVs.x?.get() ?? 0
    const layerY = layerMVs.y?.get() ?? 0
    const layerScaleX = layerMVs.scaleX?.get() ?? 1
    const layerScaleY = layerMVs.scaleY?.get() ?? 1
    let localX = E.left - P.left - layerX
    let localY = E.top - P.top - layerY
    const localWidth = layerScaleX === 0 ? E.width : E.width / layerScaleX
    const localHeight = layerScaleY === 0 ? E.height : E.height / layerScaleY
    // Compensate for `layoutScroll` ancestors between this element and
    // its projection parent. The chain (built in `m.Provider` per the
    // locked Q-layoutScroll chain-reset rule) only includes scrollers
    // whose offsets WOULD shift this element's `E - P` math —
    // ancestors above the projection parent already cancel via the
    // `E - P` subtraction and are not in the chain. See ADR 0007.
    for (const scroller of projectionContext.scrollAncestors()) {
      localX += scroller.scrollLeft
      localY += scroller.scrollTop
    }
    // `layoutAnchor` (per-element): shifts the local-coord origin to a
    // fraction of the projection parent's box. Default `{x: 0, y: 0}`
    // keeps the top-left origin (standard FLIP). For a non-resizing
    // projection parent the offset is constant across measurements
    // and cancels in deltas — no observable effect. For a resizing
    // projection parent the offset DIFFERS between first/last,
    // capturing the pivot's motion as the parent grows/shrinks. See
    // ADR 0007 §7.3.
    const anchor = untrack(getOpts).layoutAnchor
    if (anchor !== undefined) {
      localX -= P.width * anchor.x
      localY -= P.height * anchor.y
    }
    return {
      x: localX,
      y: localY,
      width: localWidth,
      height: localHeight,
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
    // `layoutId` implies `layout: true` for mode resolution — a
    // shared-element transition is always a position + size FLIP
    // (matches motion-react). Users who want a narrower mode can set
    // `layout: "position"` etc. explicitly alongside `layoutId`.
    const mode = opts.layout ?? (opts.layoutId !== undefined ? true : undefined)
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
    //
    // Collect each axis's animate-controls so we can aggregate them
    // for the FLIP-level `onLayoutAnimationComplete` lifecycle
    // callback. Each motion animate returns a thenable that resolves
    // when its tween (or cancellation) settles; `Promise.all` waits
    // for the FLIP to fully settle before firing the user's
    // onComplete.
    const controls: PromiseLike<unknown>[] = []
    if (animatePos && (deltaX !== 0 || deltaY !== 0)) {
      const xMV = ensureLayerMV("x", 0)
      const yMV = ensureLayerMV("y", 0)
      xMV.set(deltaX)
      yMV.set(deltaY)
      controls.push(runAnimation(xMV, 0, transition))
      controls.push(runAnimation(yMV, 0, transition))
    }
    if (animateSize && (sx !== 1 || sy !== 1)) {
      const sxMV = ensureLayerMV("scaleX", 1)
      const syMV = ensureLayerMV("scaleY", 1)
      sxMV.set(sx)
      syMV.set(sy)
      controls.push(runAnimation(sxMV, 1, transition))
      controls.push(runAnimation(syMV, 1, transition))
    }

    if (controls.length > 0) {
      // Fire onStart synchronously — the FLIP has just dispatched
      // (the inverse has been set; the tween is queued to animate
      // toward identity). Captured `opts` is the snapshot the
      // current measurement is acting on; subsequent opts changes
      // affect the NEXT FLIP, not this one.
      opts.onLayoutAnimationStart?.()
      Promise.all(controls).then(() => {
        // Live gate prevents firing after owner disposal — the
        // Promise.all itself can't be cancelled, but the callback
        // can be skipped.
        if (live) opts.onLayoutAnimationComplete?.()
      })
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

  function runAnimation(
    mv: MotionValue<number>,
    target: number,
    transition: Transition,
  ): PromiseLike<unknown> {
    // biome-ignore lint/suspicious/noExplicitAny: motion's animate has an overloaded shape; the MV+number form is the runtime path we want.
    const controls = animate(mv as any, target, transition as any)
    // motion's `AnimationPlaybackControls` is thenable at runtime;
    // the public type doesn't expose `.then` so narrow via cast.
    return controls as unknown as PromiseLike<unknown>
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

  // ResizeObserver(self) — fires when this element's box changes for any
  // reason (own style write via Solid binding, class change, parent
  // flex/grid reflow, font/image load, content reflow). One RO per
  // layout element; cleanup disconnects on owner disposal.
  const ro = new ResizeObserver(() => {
    scheduleMeasurement()
  })
  ro.observe(el)
  onCleanup(() => ro.disconnect())

  // MutationObserver on the immediate parent — shared across sibling
  // layout elements via the module-level WeakMap (see header). Parent is
  // snapshotted at construction; re-parenting at runtime isn't supported
  // in 0.2.0 (user remounts via key for that case).
  const parentEl = el.parentElement
  if (parentEl !== null) {
    const unsubscribe = subscribeParentMo(parentEl, scheduleMeasurement)
    onCleanup(unsubscribe)
  }

  onCleanup(() => {
    live = false
    registry.clearLayoutLayer()
    refreshWriter()
  })
}
