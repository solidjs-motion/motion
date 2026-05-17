// Phase 1 — public API surface.

// Re-exports from the upstream motion engine.
export { animate, inView, isMotionValue, motionValue, scroll, spring } from "motion"
// Context layer.
export { MotionConfig, MotionConfigContext, useMotionConfig } from "./motion-config"
export { PresenceContext, usePresenceContext } from "./presence-context"
// Imperative motion primitive (advanced — most users want useMotion instead).
export { createMotion } from "./primitives/createMotion"
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
// Reduced motion.
export { createReducedMotion, shouldReduceMotion } from "./reduced-motion"
// Style helper (also useful for users with custom directives or imperative DOM).
export { targetToStyle } from "./style"
export type * from "./types"
// Canonical hook.
export { useMotion } from "./use-motion"
// Variant resolution.
export { effectiveLabels, resolveVariant, useVariantContext, VariantContext } from "./variants"

// Placeholder kept so examples that already import the package continue to resolve
// during Phase 1; removed once useMotion lands.
export const placeholder = true
