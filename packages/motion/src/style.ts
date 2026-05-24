import { isMotionValue, type MotionValue } from "motion"
import type { JSX } from "solid-js"
import type { Target } from "./types"

// ---------------------------------------------------------------------------
// Tables (Q5 locked decisions)
// ---------------------------------------------------------------------------

/**
 * Set of CSS shortcut keys motion treats as transform components. Re-used by
 * `createMotion`'s Stage 3 animate bridge to decide whether an animate-target
 * key should be routed through the value registry (composed via the writer's
 * `el.style.transform =`) or sent down the existing WAA path.
 */
export const TRANSFORM_KEYS = /* @__PURE__ */ new Set([
  "x",
  "y",
  "z",
  "scale",
  "scaleX",
  "scaleY",
  "scaleZ",
  "rotate",
  "rotateX",
  "rotateY",
  "rotateZ",
  "skew",
  "skewX",
  "skewY",
  "transformPerspective",
])

/** Order matters — motion composes transforms in this sequence (Q5 sub-1). */
const TRANSFORM_ORDER = [
  "x",
  "y",
  "z",
  "scale",
  "scaleX",
  "scaleY",
  "scaleZ",
  "rotate",
  "rotateX",
  "rotateY",
  "rotateZ",
  "skew",
  "skewX",
  "skewY",
  "transformPerspective",
] as const

// Hyphen-case to match Solid's CSSProperties convention. The Target type
// uses csstype.PropertiesHyphen so user-supplied keys arrive at
// formatProperty in this form.
const PX_PROPERTIES = /* @__PURE__ */ new Set([
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "top",
  "right",
  "bottom",
  "left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "padding-inline",
  "padding-block",
  "padding-inline-start",
  "padding-inline-end",
  "padding-block-start",
  "padding-block-end",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-inline",
  "margin-block",
  "margin-inline-start",
  "margin-inline-end",
  "margin-block-start",
  "margin-block-end",
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "gap",
  "row-gap",
  "column-gap",
  "font-size",
  "outline-width",
  "outline-offset",
])

// ---------------------------------------------------------------------------
// Snapshot — unwrap MotionValue / Accessor / keyframe-array to a leaf value.
// Returns `undefined` when the leaf is null or undefined; callers omit those.
// ---------------------------------------------------------------------------

type Leaf = string | number

/**
 * Reduce a target-value (which may be raw, a MotionValue, an Accessor, or a
 * keyframe array) to a concrete leaf value the writer can apply to the DOM
 * or use to initialize a transient MotionValue. The cascade follows motion's
 * own semantics:
 *
 * - `null` / `undefined` → `undefined` (caller drops the key)
 * - keyframe array → first frame (consistent with motion-vanilla's
 *   initial-style snapshot)
 * - `MotionValue` → its current `.get()`
 * - `Accessor` (a bare zero-arg function) → its invocation result
 * - primitive (string / number) → returned as-is
 *
 * Exported for the MV-in-style Stage 4 work: createMotion uses it to
 * snapshot initial-target entries when registering them into the value
 * registry as transient MVs.
 */
export function snapshotValue(value: unknown): Leaf | undefined {
  if (value === null || value === undefined) return undefined
  if (Array.isArray(value)) return snapshotValue(value[0])
  if (isMotionValue(value)) return snapshotValue((value as MotionValue<Leaf>).get())
  if (typeof value === "function") return snapshotValue((value as () => unknown)())
  if (typeof value === "string" || typeof value === "number") return value
  // Anything else (objects, booleans) isn't a renderable CSS value — skip it.
  return undefined
}

// ---------------------------------------------------------------------------
// Transform composition — produce a single `transform: ...` string from the
// shorthand keys present in the target.
// ---------------------------------------------------------------------------

/**
 * Per-key transform formatter functions. Pre-built once at module load and
 * shared across all elements. Used by `createMotion`'s specialized writer
 * to avoid evaluating the transform-key switch on every single-key write —
 * at Sierpinski-scale fan-out (thousands of writes per frame) the switch's
 * 15 case-comparisons add up to non-trivial CPU.
 *
 * Pre-pick the formatter with `pickTransformFormatter(key)` ONCE at writer-
 * compile time, then the per-call cost in the hot path is just `formatter(v)`.
 */
type TransformFormatter = (value: Leaf) => string

const TRANSFORM_FORMATTERS: Readonly<Record<string, TransformFormatter>> = {
  // Translate: number → "px", string passes through verbatim.
  x: (v) => `translateX(${typeof v === "string" ? v : `${v}px`})`,
  y: (v) => `translateY(${typeof v === "string" ? v : `${v}px`})`,
  z: (v) => `translateZ(${typeof v === "string" ? v : `${v}px`})`,
  // Scale: dimensionless. Skip the type check entirely.
  scale: (v) => `scale(${v})`,
  scaleX: (v) => `scaleX(${v})`,
  scaleY: (v) => `scaleY(${v})`,
  scaleZ: (v) => `scaleZ(${v})`,
  // Rotate / skew: number → "deg", string passes through.
  rotate: (v) => `rotate(${typeof v === "string" ? v : `${v}deg`})`,
  rotateX: (v) => `rotateX(${typeof v === "string" ? v : `${v}deg`})`,
  rotateY: (v) => `rotateY(${typeof v === "string" ? v : `${v}deg`})`,
  rotateZ: (v) => `rotateZ(${typeof v === "string" ? v : `${v}deg`})`,
  skew: (v) => `skew(${typeof v === "string" ? v : `${v}deg`})`,
  skewX: (v) => `skewX(${typeof v === "string" ? v : `${v}deg`})`,
  skewY: (v) => `skewY(${typeof v === "string" ? v : `${v}deg`})`,
  transformPerspective: (v) => `perspective(${typeof v === "string" ? v : `${v}px`})`,
}

/**
 * Look up the formatter for a transform-shortcut key. Returns `undefined`
 * for non-transform keys; callers should check `TRANSFORM_KEYS.has(key)`
 * before assuming a formatter exists.
 */
export function pickTransformFormatter(key: string): TransformFormatter | undefined {
  return TRANSFORM_FORMATTERS[key]
}

/**
 * Format a motion transform-shortcut key + value as the corresponding CSS
 * transform function string (e.g. `transformFunctionFor("scale", 1.05)`
 * → `"scale(1.05)"`). One-shot variant — for hot paths, use
 * `pickTransformFormatter(key)` once at compile time and reuse.
 */
export function transformFunctionFor(key: string, value: Leaf): string {
  return TRANSFORM_FORMATTERS[key]?.(value) ?? ""
}

// ---------------------------------------------------------------------------
// Property formatting — apply unit table for non-transform CSS properties.
// ---------------------------------------------------------------------------

/**
 * Format a non-transform CSS property's value (e.g. `formatProperty("width", 100)`
 * → `"100px"`, `formatProperty("opacity", 0.5)` → `0.5`). Applies motion's
 * default-unit table (PX for dimensional CSS, dimensionless otherwise);
 * leaves CSS variables alone. Exported for `createMotion`'s writer fast path.
 */
export function formatProperty(key: string, value: Leaf): string | number {
  if (typeof value === "string") return value
  // CSS variables: stringify the number, never auto-unit (Q5 sub-4).
  if (key.startsWith("--")) return String(value)
  if (PX_PROPERTIES.has(key)) return `${value}px`
  // Dimensionless or unknown — emit the bare number.
  return value
}

// ---------------------------------------------------------------------------
// targetToStyle — the SSR/hydration linchpin. Pure, deterministic, no DOM
// reads, no time-dependent values, no input mutation. Same inputs → same
// outputs on server and client.
// ---------------------------------------------------------------------------

/**
 * Convert a {@link Target} to a Solid {@link JSX.CSSProperties} object.
 *
 * - Composes transform shorthand (`x`, `y`, `scale`, `rotate`, etc.) into a
 *   single `transform: "..."` string in motion's canonical order.
 * - Applies the default-unit table (px for dimensional CSS, deg for rotate/
 *   skew, dimensionless for scale/opacity/etc.).
 * - For keyframe arrays, uses the first frame; a leading `null`/`undefined`
 *   keyframe omits the property entirely.
 * - MotionValues and Solid Accessors are snapshotted at call time. Callers
 *   wrap in `untrack` if they don't want the read to subscribe.
 * - Skips the `transition` key (animation config, not style).
 * - CSS variables (`--foo`) emit raw values, no unit guess.
 *
 * @example
 * targetToStyle({ x: 100, scale: 0.9, opacity: 0.5 })
 * // { transform: "translateX(100px) scale(0.9)", opacity: 0.5 }
 */
export function targetToStyle(target: Target): JSX.CSSProperties {
  const out: Record<string, string | number> = {}
  const transforms: Record<string, Leaf> = {}

  for (const key in target) {
    if (key === "transition") continue
    const raw = target[key as keyof Target]
    const snapshot = snapshotValue(raw)
    if (snapshot === undefined) continue

    if (TRANSFORM_KEYS.has(key)) {
      transforms[key] = snapshot
    } else {
      out[key] = formatProperty(key, snapshot)
    }
  }

  // Compose transform string in motion's canonical order.
  const parts: string[] = []
  for (const key of TRANSFORM_ORDER) {
    if (key in transforms) {
      parts.push(transformFunctionFor(key, transforms[key] as Leaf))
    }
  }
  if (parts.length > 0) {
    out.transform = parts.join(" ")
  }

  return out as JSX.CSSProperties
}
