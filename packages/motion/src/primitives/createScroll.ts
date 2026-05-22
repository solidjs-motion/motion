import { scroll as motionScroll } from "motion"
import { batch, createEffect, onCleanup } from "solid-js"
import type { MotionValueAccessor } from "../types"
import { createMotionValue } from "./motion-value"

// ---------------------------------------------------------------------------
// Scroll progress info — motion's `OnScrollWithInfo` callback receives this
// shape per scroll tick. Sticking to the small subset we wire into our
// MotionValues to keep our public types narrow.
// ---------------------------------------------------------------------------

type ScrollAxisInfo = {
  current: number
  progress: number
  scrollLength: number
}

type MotionScrollInfo = {
  x: ScrollAxisInfo
  y: ScrollAxisInfo
}

// biome-ignore lint/suspicious/noExplicitAny: motion's offset format is internal; we re-expose it as opaque
type ScrollOffset = any[]

export type CreateScrollOptions = {
  /** Accessor returning the scroll container element. Defaults to window. */
  container?: () => Element | null
  /** Accessor returning the scroll target. Defaults to the container itself. */
  target?: () => Element | null
  /** Primary scroll axis (both axes are still populated regardless). */
  axis?: "x" | "y"
  /** Intersection offsets controlling when progress reaches 0/1. */
  offset?: ScrollOffset
  /**
   * Re-measure scroll dimensions every frame so progress stays correct when
   * page content changes size without a "scroll" event firing. Defaults to
   * `true`.
   *
   * The overhead is two property reads per frame per container — negligible
   * in practice. Set to `false` only if you know the scroll surface's size
   * never changes after subscription.
   *
   * Why default-on: motion-utils' `progress()` returns `1` as its edge-case
   * fallback when `scrollHeight === clientHeight` (no scrollable content).
   * On a client-side route transition, the new route's `createScroll` runs
   * while the new content is still in a `<Presence mode="wait">` holding
   * pen (off-DOM), so the document's scroll dimensions reflect only the
   * outgoing route. Without dimension tracking, that bogus initial dispatch
   * is the *only* signal until the user scrolls.
   */
  trackContentSize?: boolean
}

export type CreateScrollResult = {
  /** Current scroll-x position in px. Callable: `scrollX()` for reactive read. */
  scrollX: MotionValueAccessor<number>
  /** Current scroll-y position in px. Callable: `scrollY()` for reactive read. */
  scrollY: MotionValueAccessor<number>
  /** Normalized scroll-x progress in `[0, 1]` (or `[0, n]` for multi-offset). */
  scrollXProgress: MotionValueAccessor<number>
  /** Normalized scroll-y progress in `[0, 1]`. */
  scrollYProgress: MotionValueAccessor<number>
}

/**
 * Bind four {@link MotionValueAccessor}s to a scroll source. Mirrors
 * motion/react's `useScroll`; defaults to the window when no container is
 * supplied. Each returned value is callable as a Solid Accessor AND has the
 * full MotionValue surface, so it composes with `useMotion`'s target,
 * `animate()`, `createTransform`, and direct JSX reactivity.
 *
 * @example
 * const { scrollY, scrollYProgress } = createScroll()
 * const opacity = createTransform(scrollYProgress, [0, 1], [1, 0])
 *
 * @example
 * const [el, setEl] = createSignal<HTMLElement>()
 * const { scrollY } = createScroll({ container: el })
 * <div ref={setEl} style={{ overflow: "auto" }}>...</div>
 */
export function createScroll(options?: CreateScrollOptions): CreateScrollResult {
  const scrollX = createMotionValue(0)
  const scrollY = createMotionValue(0)
  const scrollXProgress = createMotionValue(0)
  const scrollYProgress = createMotionValue(0)

  // createEffect — Solid-idiomatic for side-effect setup (attaching the
  // motion scroll subscription). First iteration runs in the next
  // microtask, which is harmless: scroll events can't fire before the
  // microtask flushes after mount. Accessors inside the body (container,
  // target) are tracked — re-init happens when refs change.
  //
  // Each iteration's onCleanup is scoped to that iteration — Solid fires
  // it when the effect re-runs (tearing down the previous subscription)
  // and again when the outer owner disposes (tearing down the final one).
  createEffect(() => {
    const container = options?.container?.() ?? undefined
    const target = options?.target?.() ?? undefined
    const trackContentSize = options?.trackContentSize ?? true

    // Suppress motion-dom's "no scrollable content" edge-case dispatch.
    //
    // motion-utils' `progress(0, 0, 0)` returns `1` when `scrollHeight`
    // equals `clientHeight`. On a Presence wait-mode route transition,
    // the new route mounts in an off-DOM holding pen — at subscribe time
    // `document.documentElement.scrollHeight` still reflects only the
    // outgoing (often non-scrollable) route, so the very first handler
    // call arrives with `scrollLength === 0` on both axes and a bogus
    // `progress === 1`. Without suppression, that paints a fully-filled
    // progress bar until the next user scroll.
    //
    // We hold the MVs at their initial 0 until motion-dom reports a real
    // measurement — non-zero `scrollLength` on either axis OR non-zero
    // `current`. With `trackContentSize` default-on, motion-dom's
    // per-frame dimension check fires the listener again as soon as the
    // new content lands in the live DOM, naturally flipping the gate.
    let hasRealMeasurement = false

    const handler = (_progress: number, info?: MotionScrollInfo): void => {
      if (!info) return

      if (
        !hasRealMeasurement &&
        info.x.scrollLength === 0 &&
        info.y.scrollLength === 0 &&
        info.x.current === 0 &&
        info.y.current === 0
      ) {
        return
      }
      hasRealMeasurement = true

      batch(() => {
        scrollX.set(info.x.current)
        scrollY.set(info.y.current)
        scrollXProgress.set(info.x.progress)
        scrollYProgress.set(info.y.progress)
      })
    }

    const cleanup = motionScroll(handler, {
      container: container as HTMLElement | undefined,
      target: target as HTMLElement | undefined,
      axis: options?.axis,
      offset: options?.offset,
      trackContentSize,
    } as Parameters<typeof motionScroll>[1])
    onCleanup(cleanup)
  })

  return { scrollX, scrollY, scrollXProgress, scrollYProgress }
}
