import { createContext, useContext } from "solid-js"
import type { Target, VariantContextValue, VariantLabels, Variants } from "./types"

/**
 * Empty default — descendants without an enclosing motion wrapper get a
 * cleanly-typed "no propagation" context.
 */
const emptyVariantContext: VariantContextValue = {}

/**
 * Solid context propagating variant state from a motion ancestor to its
 * descendants. Only the wrapper components (`<motion.div>`, `motion(...)`)
 * provide a value. Bare `useMotion` consumers can opt in via the `Provider`
 * returned alongside the getter.
 */
export const VariantContext = createContext<VariantContextValue>(emptyVariantContext)

export function useVariantContext(): VariantContextValue {
  return useContext(VariantContext)
}

/**
 * Resolve a variant label (or array of labels) against a variants map and the
 * current `custom` value. Returns a {@link Target} object, or `null` if nothing
 * resolves.
 *
 * Resolution rules locked in Phase 1 Q4:
 *
 * - Child's own `variants` always wins for a given name (sub-1A).
 * - No cascade: if a child has no `variants` of its own, parent's are NOT
 *   consulted (sub-1B / Pattern X). Callers pass `variants = undefined` in
 *   that case and this returns `null`.
 * - String + array forms both supported; array variants merge in order
 *   (later wins on conflicting keys).
 * - Function variants are invoked with `custom`; the value can be any type.
 *
 * @example
 * const variants = { visible: { opacity: 1 }, hidden: { opacity: 0 } }
 * resolveVariant("visible", variants, undefined)
 * // { opacity: 1 }
 *
 * resolveVariant(["visible", "highlighted"], variants, undefined)
 * // merged in order, last variant's keys override
 *
 * resolveVariant("visible", { visible: (i: number) => ({ x: i * 10 }) }, 3)
 * // { x: 30 }
 */
export function resolveVariant(
  names: VariantLabels | undefined,
  variants: Variants | undefined,
  custom: unknown,
): Target | null {
  if (!names || !variants) return null

  const list = Array.isArray(names) ? names : [names]
  let merged: Target | null = null

  for (const name of list) {
    const variant = variants[name]
    if (!variant) continue
    const resolved: Target = typeof variant === "function" ? variant(custom) : variant
    // Object.assign sidesteps TS's "spread types may only be created from object
    // types" error caused by Target's index signature including `undefined`.
    merged = merged ? Object.assign({}, merged, resolved) : Object.assign({}, resolved)
  }

  return merged
}

/**
 * Determine the effective variant name for a given motion state. If the caller
 * provided an explicit value (string, array, or Target object), that wins.
 * Otherwise the parent context's value (per gesture/state) is used as a fall-
 * back.
 *
 * Returns the explicit value as-is when it's a Target object (used by callers
 * to detect "explicit target — skip variant lookup entirely").
 */
export function effectiveLabels(
  own: VariantLabels | Target | undefined,
  parent: VariantLabels | undefined,
): VariantLabels | Target | undefined {
  if (own !== undefined) return own
  return parent
}
