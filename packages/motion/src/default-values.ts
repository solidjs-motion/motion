// ---------------------------------------------------------------------------
// Default value table for transform-class and a few well-known CSS properties.
// Used by the gesture state machine's "removed keys" fallback (Q7): when a
// higher-priority gesture deactivates and no lower-priority state defines a
// key, we animate the key back to:
//   1. the user's `initial` target (captured at mount) — handled at call site
//   2. otherwise the value from this table
//   3. otherwise `null` (motion's animate() reads from computed style)
//
// The values here mirror motion-dom's conventions (scale → 1, x/y/z → 0,
// rotate/skew → 0, opacity → 1). We don't import motion-dom's defaultValueTypes
// directly because (a) it's a value-type system, not a defaults table, and
// (b) keeping a stable local source insulates us from motion-dom internal churn.
// ---------------------------------------------------------------------------

const TRANSFORM_DEFAULTS: Readonly<Record<string, number>> = {
  // Translate
  x: 0,
  y: 0,
  z: 0,
  translateX: 0,
  translateY: 0,
  translateZ: 0,
  // Scale (multiplicative identity)
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
  // Rotate
  rotate: 0,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  // Skew
  skew: 0,
  skewX: 0,
  skewY: 0,
  // Perspective
  perspective: 0,
  transformPerspective: 0,
  // Opacity (the one non-transform key with a strong default)
  opacity: 1,
}

/**
 * Look up the canonical fallback value for a property key. Returns the table
 * value if known, else `null` — which motion's `animate()` interprets as
 * "read from computed style at animation start."
 */
export function getMotionDefault(key: string): number | null {
  return TRANSFORM_DEFAULTS[key] ?? null
}
