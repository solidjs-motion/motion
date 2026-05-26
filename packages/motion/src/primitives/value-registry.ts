import { type MotionValue, motionValue } from "motion"
import type { Target } from "../types"

// ---------------------------------------------------------------------------
// Per-element value registry.
//
// One `ValueRegistry` per element managed by `createMotion`. It maps style /
// transform-shortcut keys (`scale`, `y`, `opacity`, etc.) to the
// `MotionValue` that authoritatively drives the corresponding CSS or
// transform component for that element.
//
// This is the motion-react `visualElement.values` shape, slimmed down. It
// exists to unify two write paths that currently disagree about who owns a
// CSS key on the element:
//
//   1. **User-provided MVs in `style`** — `<motion.div style={{ scale: mv }}>`.
//      mv is the source of truth for `scale`; subscribing to it and writing
//      `el.style.transform` is the only way the new value reaches the DOM.
//   2. **animate-target writes** — `useMotion({ animate: { scale: 1.5 } })`.
//      Today these go directly via WAA (`animate(el, target, opts)`). After
//      Stage 3 they will be routed through the registry: if a key has a
//      registered MV, the animation tweens that MV (which writes the DOM
//      via its subscription) instead of writing the element directly.
//
// Stage 1 introduces only the data structure. No code reads from or writes
// to it yet — `createMotion` instantiates an empty registry, attaches a
// disposal hook, and stops there. Subsequent stages wire it up.
//
// Two ownership classes:
//
// - **External** — MVs the user created via `createMotionValue` / motion's
//   `motionValue()` and handed us via `style`. The registry tracks them so
//   we know "this key is MV-backed" but does NOT dispose them. The user
//   owns their MV's lifetime.
//
// - **Transient** — MVs the registry creates internally (Stage 3) because
//   an animate target referenced a key with no existing MV. The registry
//   owns these and clears them on `dispose()`. motion's MotionValue has no
//   imperative teardown method; releasing references is what lets GC
//   collect them once all subscribers have cleaned up.
// ---------------------------------------------------------------------------

/**
 * Layout-layer axis identifiers. The string spelling exists ONLY here
 * (as a discriminator for `setLayoutValue`) — it is NOT a runtime key
 * in the registry's `values` Map. The names `_layoutX`, `_layoutY`,
 * `_layoutScaleX`, `_layoutScaleY` referenced in ADR 0006 are
 * documentary; at runtime the layer is a typed sub-record with `x` /
 * `y` / `scaleX` / `scaleY` fields, accessed via dotted property
 * lookup at fold time. See ADR 0006 for the design rationale.
 */
export type LayoutAxis = "x" | "y" | "scaleX" | "scaleY"

/**
 * Layout's second-layer contribution to the registry's transform writer.
 * Up to four MVs (one per axis); when present, the writer FOLDS each
 * axis into the corresponding user-facing key at compile time
 * (`effectiveX = x + layer.x`, `effectiveScaleX = scaleX * layer.scaleX`).
 *
 * Owned by the layout controller (added in a later step); cleared on
 * `layout` toggling off via `clearLayoutLayer()`. See ADR 0006.
 */
export type LayoutLayer = {
  x?: MotionValue<number>
  y?: MotionValue<number>
  scaleX?: MotionValue<number>
  scaleY?: MotionValue<number>
}

export type ValueRegistry = {
  /** Returns the MV registered for `key`, or `undefined` if none. */
  get(key: string): MotionValue<unknown> | undefined
  /** Has any MV been registered for `key`? */
  has(key: string): boolean
  /**
   * Number of entries currently registered. Used by `createMotion` to decide
   * whether the per-element writer can take a specialized single-key path
   * (size === 1) or needs the general-purpose `applyStaticStyle` walk.
   *
   * Excludes the layout layer — that's tracked separately via
   * {@link hasLayoutLayer} because it doesn't flow through the
   * string-keyed `values` Map.
   */
  readonly size: number
  /**
   * Register a user-provided MV. The registry will NOT dispose it on
   * teardown. If a transient MV exists for the key, it is replaced (the
   * external MV becomes the new source of truth).
   */
  setExternal(key: string, mv: MotionValue<unknown>): void
  /**
   * Get the MV for `key`, creating a transient one initialized to
   * `fallback` if absent. Transient MVs are disposed on `dispose()`.
   */
  getOrCreateTransient(key: string, fallback: unknown): MotionValue<unknown>
  /** Iterate every (key, MV) pair currently registered. */
  entries(): IterableIterator<[string, MotionValue<unknown>]>
  /**
   * Drop registry-owned (transient) MVs. External MVs are untouched.
   * Subscription cleanups are owned by whoever called `mv.on(...)`; they
   * tie to the surrounding Solid owner via `onCleanup` in Stage 2+ so we
   * don't unsubscribe imperatively here.
   */
  dispose(): void
  /**
   * Layout's second-layer contribution. Empty by default; populated via
   * {@link setLayoutValue} from the layout controller and cleared via
   * {@link clearLayoutLayer} on `layout` toggle-off. See ADR 0006.
   */
  readonly layoutLayer: LayoutLayer
  /**
   * Has the layout layer registered any axis? Drives the writer's
   * fast-path selection: when true, the single-key writer is bypassed
   * even if `size === 1`, because the fold needs the multi-key path.
   */
  readonly hasLayoutLayer: boolean
  /**
   * Install or replace an MV for a layout-layer axis. Layout-controller
   * internal use only — there is no string-keyed public path that can
   * reach this surface (per ADR 0006's "no public string-keyed write
   * API for the layer at all" formulation).
   */
  setLayoutValue(axis: LayoutAxis, mv: MotionValue<number>): void
  /**
   * Drop all layout-layer MVs. Called by the layout controller when
   * `layout` toggles off mid-life.
   */
  clearLayoutLayer(): void
}

/**
 * Compose a translate-axis fold. Layer contribution is always a pixel
 * delta (numeric, from `getBoundingClientRect`); the user-side value
 * can be:
 *
 * - `number` → additive: `userPx + layerPx`.
 * - `string` (e.g. `"50%"`, `"calc(var(--x) + 10px)"`, `"10vw"`) →
 *   composed via CSS `calc()`: `calc(<user> + <layer>px)` or
 *   `calc(<user> - <abs(layer)>px)` for negative deltas. Direct
 *   interpolation of a negative number into `+ -30px` produces invalid
 *   CSS — we split into `-` operator + absolute value.
 * - `undefined` → layer value alone (numeric).
 *
 * Layer of exactly `0` is a no-op when the user is a string (no calc
 * wrapper added; the original string passes through).
 */
function composeTranslateAxis(userValue: unknown, layerPx: number): unknown {
  if (typeof userValue === "number") return userValue + layerPx
  if (typeof userValue === "string") {
    if (layerPx === 0) return userValue
    const sign = layerPx < 0 ? "-" : "+"
    return `calc(${userValue} ${sign} ${Math.abs(layerPx)}px)`
  }
  return layerPx
}

/**
 * Compose a scale-axis fold. Layer contribution is a numeric factor;
 * the effective user-side value is the per-axis value if defined, else
 * the shortcut `scale`, else `1`. String user-side values (rare; e.g.,
 * `scaleX: "var(--base-scale)"`) compose via CSS `calc()`:
 * `calc((<user>) * <layer>)`.
 *
 * Layer of exactly `1` is a no-op (user value passes through).
 */
function composeScaleAxis(userValue: unknown, layerFactor: number): number | string {
  if (layerFactor === 1) {
    if (typeof userValue === "number" || typeof userValue === "string") return userValue
    return 1
  }
  if (typeof userValue === "number") return userValue * layerFactor
  if (typeof userValue === "string") return `calc((${userValue}) * ${layerFactor})`
  return layerFactor
}

/**
 * Pure helper — folds {@link LayoutLayer} contributions into a target
 * Record IN PLACE before it reaches {@link targetToStyle}. Exported
 * for unit testing; `createMotion`'s `multiKeyWriter` is the only
 * production caller.
 *
 * Translate fold is additive; scale fold is multiplicative. Both
 * support mixed-unit user values via CSS `calc()`:
 *
 * - Numeric user + numeric layer → numeric result.
 * - String user + numeric layer → `calc(...)` string result.
 * - Undefined user → layer alone.
 *
 * The scale fold expands the `scale` shortcut to `scaleX` / `scaleY`
 * whenever EITHER axis has a layer contribution, so `TRANSFORM_ORDER`'s
 * emission doesn't double-apply `scale(s)` AND `scaleX(s * layer)`.
 * When only one axis has a layer, the other axis inherits the original
 * `scale` value explicitly so its semantics survive the `scale` delete.
 *
 * @see [ADR 0006](../../../../docs/adr/0006-layout-transform-composition.md)
 */
export function foldLayoutLayerIntoTarget(
  target: Record<string, unknown>,
  layer: LayoutLayer,
): void {
  // --- Translates: additive (calc() for mixed units) ---
  if (layer.x !== undefined) {
    target.x = composeTranslateAxis(target.x, layer.x.get())
  }
  if (layer.y !== undefined) {
    target.y = composeTranslateAxis(target.y, layer.y.get())
  }

  // --- Scales: multiplicative (calc() for mixed units) ---
  const hasScaleX = layer.scaleX !== undefined
  const hasScaleY = layer.scaleY !== undefined
  if (hasScaleX || hasScaleY) {
    const rawScale = target.scale
    // Effective user values: per-axis overrides scale shortcut overrides 1.
    const userScaleX = target.scaleX !== undefined ? target.scaleX : rawScale
    const userScaleY = target.scaleY !== undefined ? target.scaleY : rawScale

    if (hasScaleX) {
      // biome-ignore lint/style/noNonNullAssertion: hasScaleX guards layer presence.
      target.scaleX = composeScaleAxis(userScaleX, layer.scaleX!.get())
    } else if (rawScale !== undefined && target.scaleX === undefined) {
      // Layer doesn't fold scaleX but we're about to delete `scale` —
      // propagate the original shortcut to scaleX so its semantics survive.
      target.scaleX = rawScale
    }

    if (hasScaleY) {
      // biome-ignore lint/style/noNonNullAssertion: hasScaleY guards layer presence.
      target.scaleY = composeScaleAxis(userScaleY, layer.scaleY!.get())
    } else if (rawScale !== undefined && target.scaleY === undefined) {
      target.scaleY = rawScale
    }

    if (rawScale !== undefined) {
      delete target.scale
    }
  }
}

// Re-export the public Target type so callers (and the JSDoc above)
// can resolve it from this module's namespace without a separate
// import in tests.
export type { Target }

export function createValueRegistry(): ValueRegistry {
  const values = new Map<string, MotionValue<unknown>>()
  const transient = new Set<MotionValue<unknown>>()
  // Mutable storage for the layout layer. The `layoutLayer` getter
  // returns this object (read-only via the public type) so consumers
  // see the latest axis MVs without re-querying.
  const layer: LayoutLayer = {}
  let layerActiveCount = 0

  return {
    get(key) {
      return values.get(key)
    },
    has(key) {
      return values.has(key)
    },
    setExternal(key, mv) {
      const existing = values.get(key)
      if (existing && transient.has(existing)) {
        // Replacing a transient with an external takes the transient out
        // of the owned-set so dispose() doesn't pretend to manage it.
        transient.delete(existing)
      }
      values.set(key, mv)
    },
    getOrCreateTransient(key, fallback) {
      const existing = values.get(key)
      if (existing) return existing
      const mv = motionValue(fallback) as MotionValue<unknown>
      values.set(key, mv)
      transient.add(mv)
      return mv
    },
    entries() {
      return values.entries()
    },
    get size() {
      return values.size
    },
    dispose() {
      transient.clear()
      values.clear()
      // Clear the layer too — controller ownership ends with the registry.
      layer.x = undefined
      layer.y = undefined
      layer.scaleX = undefined
      layer.scaleY = undefined
      layerActiveCount = 0
    },
    get layoutLayer() {
      return layer
    },
    get hasLayoutLayer() {
      return layerActiveCount > 0
    },
    setLayoutValue(axis, mv) {
      if (layer[axis] === undefined) layerActiveCount++
      layer[axis] = mv
    },
    clearLayoutLayer() {
      layer.x = undefined
      layer.y = undefined
      layer.scaleX = undefined
      layer.scaleY = undefined
      layerActiveCount = 0
    },
  }
}
