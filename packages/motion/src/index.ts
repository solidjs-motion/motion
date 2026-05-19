// Public API surface.

// Re-exports from the upstream motion engine.
export { animate, inView, isMotionValue, motionValue, scroll, spring } from "motion"
// Context layer.
export { MotionConfig, MotionConfigContext, useMotionConfig } from "./motion-config"
// Presence — exit-animation coordinator + imperative hook (Phase 3).
export {
  Presence,
  type PresenceProps,
  type UseAnimatePresenceOptions,
  type UseAnimatePresenceResult,
  useAnimatePresence,
} from "./presence"
export { PresenceContext, usePresenceContext } from "./presence-context"
// Imperative motion primitive (advanced — most users want useMotion instead).
export { createDragControls } from "./primitives/createDragControls"
export {
  type CreateInViewOptions,
  type CreateInViewResult,
  createInView,
} from "./primitives/createInView"
export { createMotion } from "./primitives/createMotion"
export {
  type CreatePanOptions,
  type CreatePanResult,
  createPan,
  type PanAxisPair,
} from "./primitives/createPan"
export {
  type CreateScrollOptions,
  type CreateScrollResult,
  createScroll,
} from "./primitives/createScroll"
// MotionValue family — callable-hybrid primitives. Every value returned here
// is both a Solid Accessor (call it: `mv()`) AND a motion.MotionValue
// (methods: `.get`, `.set`, `.jump`, `.on`, etc.).
export {
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
