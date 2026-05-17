// Phase 1 — public API surface.

// Re-exports from the upstream motion engine.
export { animate, inView, isMotionValue, motionValue, scroll, spring } from "motion"

// MotionValue family + Solid signal bridge.
export {
  createMotionSignal,
  createMotionValue,
  createMotionValueEvent,
  createSpring,
  createTemplate,
  createTime,
  createTransform,
  createVelocity,
  toSignal,
} from "./primitives/motion-value"

// Style helper (also useful for users with custom directives or imperative DOM).
export { targetToStyle } from "./style"
export type * from "./types"

// Placeholder kept so examples that already import the package continue to resolve
// during Phase 1; removed once useMotion lands.
export const placeholder = true
