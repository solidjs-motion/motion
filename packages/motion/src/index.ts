// Public API surface.

// Re-exports from the upstream motion engine.
export { animate, inView, isMotionValue, motionValue, scroll, spring } from "motion"
// Context layer.
export { LayoutGroup } from "./layout-group"
export { LayoutGroupContext, useLayoutGroupContext } from "./layout-group-context"
export { MotionConfig, MotionConfigContext, useMotionConfig } from "./motion-config"
// motion proxy (Phase 4) — indexable surface yielding cached, motion-aware
// tag-components per HTML/SVG tag. `motion.create` (the HOC entry point)
// lands in the follow-up commit.
export { MOTION_OPT_KEYS, type Motion, motion } from "./motion-proxy"
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
export { createAttributeSignal } from "./primitives/createAttributeSignal"
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
export { createReorder, type ReorderResult } from "./primitives/createReorder"
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
// Reorder — drag-driven list-reorder compound component.
export {
  Reorder,
  type ReorderGroupProps,
  type ReorderItemProps,
} from "./reorder"
// Style helper (also useful for users with custom directives or imperative DOM).
export { targetToStyle } from "./style"
export type * from "./types"
// Canonical hook.
export { useMotion } from "./use-motion"
// Variant resolution.
export { effectiveLabels, resolveVariant, useVariantContext, VariantContext } from "./variants"
