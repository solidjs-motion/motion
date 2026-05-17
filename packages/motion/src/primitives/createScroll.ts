import { scroll as motionScroll } from "motion"
import { createComputed, onCleanup } from "solid-js"
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

  // motion's scroll callback signature has two forms (OnScrollProgress and
  // OnScrollWithInfo). With two parameters, info is passed.
  const handler = (_progress: number, info?: MotionScrollInfo) => {
    if (!info) return
    scrollX.set(info.x.current)
    scrollY.set(info.y.current)
    scrollXProgress.set(info.x.progress)
    scrollYProgress.set(info.y.progress)
  }

  // Reactive setup: accessors inside the computation are tracked, so re-init
  // happens when container/target refs change. createComputed runs both first
  // iteration and updates synchronously, so the motion subscription registers
  // before createRoot/render returns.
  //
  // Each iteration's onCleanup is scoped to that iteration — Solid fires it
  // when the computation re-runs (tearing down the previous subscription) and
  // again when the outer owner disposes (tearing down the final one).
  createComputed(() => {
    const container = options?.container?.() ?? undefined
    const target = options?.target?.() ?? undefined
    const cleanup = motionScroll(handler, {
      container: container as HTMLElement | undefined,
      target: target as HTMLElement | undefined,
      axis: options?.axis,
      offset: options?.offset,
    } as Parameters<typeof motionScroll>[1])
    onCleanup(cleanup)
  })

  return { scrollX, scrollY, scrollXProgress, scrollYProgress }
}
