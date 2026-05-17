import { type MotionValue, scroll as motionScroll } from "motion"
import { createComputed, onCleanup } from "solid-js"
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
  /** Current scroll-x position in px. */
  scrollX: MotionValue<number>
  /** Current scroll-y position in px. */
  scrollY: MotionValue<number>
  /** Normalized scroll-x progress in `[0, 1]` (or `[0, n]` for multi-offset). */
  scrollXProgress: MotionValue<number>
  /** Normalized scroll-y progress in `[0, 1]`. */
  scrollYProgress: MotionValue<number>
}

/**
 * Bind four {@link MotionValue}s to a scroll source. Mirrors motion/react's
 * `useScroll`; defaults to the window when no container is supplied.
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
  // happens when container/target refs change. createComputed runs both its
  // first iteration and subsequent updates synchronously, so the motion
  // subscription is registered before the createRoot/render call returns.
  // The previous subscription is torn down before each new one is created.
  let cleanupCurrent: (() => void) | null = null
  createComputed(() => {
    cleanupCurrent?.()
    const container = options?.container?.() ?? undefined
    const target = options?.target?.() ?? undefined
    cleanupCurrent = motionScroll(handler, {
      container: container as HTMLElement | undefined,
      target: target as HTMLElement | undefined,
      axis: options?.axis,
      offset: options?.offset,
    } as Parameters<typeof motionScroll>[1])
  })

  onCleanup(() => cleanupCurrent?.())

  return { scrollX, scrollY, scrollXProgress, scrollYProgress }
}
