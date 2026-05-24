import { animate, type MotionValue } from "motion"
import { type Accessor, createSignal, onCleanup, untrack } from "solid-js"
import { useLayoutGroupContext } from "../layout-group-context"
import { useMotionConfig } from "../motion-config"
import { usePresenceContext } from "../presence-context"
import { useProjectionContext } from "../projection-context"
import { createReducedMotion, shouldReduceMotion } from "../reduced-motion"
import {
  formatProperty,
  pickTransformFormatter,
  snapshotValue,
  TRANSFORM_KEYS,
  targetToStyle,
} from "../style"
import type {
  AnimateValue,
  MotionElement,
  MotionOptions,
  ProjectionContextValue,
  Target,
  Transition,
  VariantContextValue,
  VariantLabels,
  Variants,
} from "../types"
import { effectiveLabels, resolveVariant, useVariantContext } from "../variants"
import { createDrag } from "./createDrag"
import { createGestures } from "./createGestures"
import { createLayoutController } from "./createLayoutController"
import { type ActiveStoreTuple, createGestureStateMachine } from "./gesture-state"
import {
  createValueRegistry,
  foldLayoutLayerIntoTarget,
  type ValueRegistry,
} from "./value-registry"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect whether an animate-value is a variant name (string or string[]) vs.
 * an explicit target object. Returns the labels or undefined.
 */
export function asVariantLabels(value: AnimateValue | undefined): VariantLabels | undefined {
  if (value === undefined) return undefined
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value
  return undefined
}

/**
 * Resolve a per-state animate value into a {@link Target}. Implements the
 * Q4 sub-2 priority table:
 *
 * - explicit Target object → use as-is (parent context ignored)
 * - variant name → look up in own variants only (no cascade)
 * - undefined → fall back to parent context's variant name, then look up in
 *   own variants
 */
export function resolveTarget(
  ownValue: AnimateValue | undefined,
  ownVariants: Variants | undefined,
  parentLabel: VariantLabels | undefined,
  custom: unknown,
): Target | null {
  // Explicit Target object — variant lookup is skipped entirely.
  if (ownValue !== undefined && typeof ownValue !== "string" && !Array.isArray(ownValue)) {
    return ownValue as Target
  }

  const labels = effectiveLabels(ownValue, parentLabel)
  if (labels === undefined) return null
  // After the explicit-object check above, `labels` is VariantLabels or a
  // Target that came from `parentLabel` slot — but parent context only
  // propagates labels, never Targets, so it's safe to treat as labels here.
  return resolveVariant(labels as VariantLabels, ownVariants, custom)
}

/**
 * Merge transition specs in priority order: MotionConfig default <
 * user's `transition` < per-target `transition`. When reduced motion is
 * active, returns `{ duration: 0 }` and drops everything else (Q11 sub-4).
 */
export function mergeTransition(
  configDefault: Transition | undefined,
  ownTransition: Transition | undefined,
  perTargetTransition: Transition | undefined,
  reduced: boolean,
): Transition {
  if (reduced) return { duration: 0 } as Transition
  return {
    ...(configDefault ?? {}),
    ...(ownTransition ?? {}),
    ...(perTargetTransition ?? {}),
  } as Transition
}

/**
 * Apply a static target to an element's inline style before paint. Used on
 * mount when no SSR style was emitted. The ref callback fires before the
 * browser yields, so this avoids a frame of flicker.
 */
function applyStaticStyle(el: MotionElement, target: Target): void {
  const style = targetToStyle(target)
  for (const key in style) {
    const value = (style as Record<string, string | number | undefined>)[key]
    if (value === undefined) continue
    if (key.startsWith("--")) {
      el.style.setProperty(key, String(value))
    } else {
      // ElementCSSInlineStyle.style is indexable for camelCase property names.
      // Available on both HTMLElement and SVGElement (Phase 4 SVG support).
      ;(el.style as unknown as Record<string, string | number>)[key] = value
    }
  }
}

// ---------------------------------------------------------------------------
// createMotion — the imperative primitive that drives one element's motion
// state. useMotion wraps this; <motion.*> and motion() will wrap it too.
// ---------------------------------------------------------------------------

export type CreateMotionConfig = {
  /**
   * When true, `createMotion` skips applying the initial style — the server
   * already emitted it inline, and re-applying on hydration would shift the
   * paint. Detected via the `data-motion-hydrated` marker in useMotion.
   */
  initialAppliedBySSR?: boolean
  /**
   * Q4 — useMotion lifts the gesture-state active store one level up so its
   * `myVariantCtx` can read the same flags it propagates to descendants.
   * When omitted (standalone createMotion use), the state machine creates
   * its own internal store.
   */
  activeStore?: ActiveStoreTuple
  /**
   * Q4 follow-up — useMotion passes a shadowed parent context here so the
   * controlling-variants check is applied uniformly. When omitted, createMotion
   * falls back to `useVariantContext()` directly (the standalone path).
   */
  parentContext?: VariantContextValue
  /**
   * MV-in-style Stage 2 — useMotion scrapes `MotionValue`-valued keys out of
   * the user's `style` prop and passes them here. createMotion registers
   * each as an external (user-owned) entry in the value registry and
   * subscribes a writer that re-composes `el.style` from the registry
   * snapshot on every change.
   */
  styleMotionValues?: Map<string, MotionValue<unknown>>
  /**
   * MV-in-style Stage 4 — static transform-shortcut entries in the user's
   * `style` (e.g., `style={{ x: 10, scale: mv }}`'s `x: 10`). useMotion scrapes
   * these alongside MVs so createMotion can seed transient registry entries
   * for them. Without this, the writer would drop the static keys on every
   * recompose since they wouldn't appear in the registry.
   *
   * Map values are the resolved leaf (number or string) — no MVs, no
   * keyframe arrays, no accessor functions. useMotion runs the
   * `snapshotValue` reduction before passing them in.
   */
  styleStaticTransforms?: Map<string, number | string>
  /**
   * The motion proxy threads its captured OUTER projection context
   * here so the element measures against its true parent context.
   *
   * Why this can't be `useProjectionContext()` inside createMotion: the
   * motion proxy renders the underlying DOM element INSIDE the element's
   * OWN `m.Provider`, so when the ref fires the owner-chain lookup
   * finds the element's own myProjectionCtx — which (for layout-active
   * elements) returns the element itself as projection parent. Result:
   * the controller measures against itself, `E - P = 0` on every
   * measurement, no FLIP fires.
   *
   * Direct createMotion / useMotion callers (without the proxy) don't
   * pass this and fall back to the live `useProjectionContext()`,
   * which is correct because they place `<m.Provider>` MANUALLY around
   * descendants — the live context at ref-fire IS the parent context.
   */
  parentProjectionContext?: ProjectionContextValue
}

/**
 * The imperative primitive: bind an element to a reactive motion-options
 * source. Caller is responsible for keeping the element alive (refs in a
 * component, drag controls, etc.).
 *
 * Phase 1 scope: animate + initial + transition + lifecycle hooks +
 * reduced-motion override + presence registration. Phase 2 layers gesture
 * states (hover/press/focus/inView) and drag on top.
 */
export function createMotion(
  el: MotionElement,
  opts: MotionOptions | Accessor<MotionOptions>,
  config?: CreateMotionConfig,
): void {
  const getOpts: () => MotionOptions = typeof opts === "function" ? opts : () => opts
  // Q4 follow-up: useMotion passes a shadowed (controlling-aware) context;
  // standalone callers fall back to the live VariantContext.
  const parentVariantCtx: VariantContextValue = config?.parentContext ?? useVariantContext()
  const presence = usePresenceContext()
  const motionConfig = useMotionConfig()
  const systemReducedMotion = createReducedMotion()
  // Layout contexts read unconditionally — same pattern as
  // presence/motionConfig above (Q-option a from step 7 sign-off). The
  // controller below consumes them only when `opts.layout` is truthy
  // at construction; non-layout elements pay two `Map.get` calls.
  // When the motion proxy is the caller, it passes the OUTER projection
  // context (captured before m.Provider wraps the element). Direct
  // callers fall back to `useProjectionContext()` — correct because
  // they place `<m.Provider>` manually around descendants.
  const projectionContext = config?.parentProjectionContext ?? useProjectionContext()
  const layoutGroupContext = useLayoutGroupContext()

  // ---------- Per-element value registry (lazy — Stage 4.5) ----------
  // Most elements never need a registry: they have no MV in style, no static
  // transform shortcut in style, and no Stage 3 transient is ever required
  // because the WAA dispatch path stays active throughout. For those elements
  // (the bulk of typical motion usage), allocating an empty registry was pure
  // waste. We now create it on first use via `ensureRegistry()`.
  //
  // No `onCleanup(() => valueRegistry?.dispose())` — `dispose()` was just
  // `transient.clear() + values.clear()`. When createMotion's closure dies,
  // GC reclaims the Map+Set + their MV references; user-provided MVs survive
  // because they have other references; transient MVs that no longer have
  // any subscriber will GC naturally. Calling dispose() explicitly bought
  // nothing.
  let valueRegistry: ValueRegistry | undefined
  const ensureRegistry = (): ValueRegistry => {
    if (!valueRegistry) valueRegistry = createValueRegistry()
    return valueRegistry
  }

  // Snapshot once at construction. Subsequent reactivity goes through
  // the createEffect below, so we don't subscribe in the body of this fn.
  const initialOpts = untrack(getOpts)

  // ---------- Resolve the initial target (used for BOTH static-style write AND
  //            the state machine's removed-key fallback chain, Q7) ----------
  // Priority chain (matches use-motion's computeInitialStyle):
  //   own.initial > parent.initial > own.animate > parent.animate
  //
  // We resolve this regardless of `initialAppliedBySSR` because the state
  // machine needs it even when SSR already wrote the inline style — the user's
  // explicit `initial` value is part of their intent and should anchor the
  // removed-key fallback regardless of who painted it.
  let capturedInitialTarget: Target | null = null
  if (initialOpts.initial !== false) {
    const inheritedInitial = parentVariantCtx.initial?.()
    const inheritedAnimate = parentVariantCtx.animate?.()
    const effective =
      initialOpts.initial !== undefined
        ? initialOpts.initial
        : inheritedInitial !== undefined
          ? inheritedInitial
          : initialOpts.animate !== undefined
            ? initialOpts.animate
            : inheritedAnimate
    if (effective !== undefined) {
      capturedInitialTarget = resolveTarget(
        effective,
        initialOpts.variants,
        undefined, // priority chain already consumed parent's labels
        initialOpts.custom ?? parentVariantCtx.custom?.(),
      )
    }
  }

  // ---------- Apply the initial style pre-paint, unless SSR already did it ----------
  // An enclosing `<Presence initial={false}>` ALSO suppresses the static
  // style application — the descendant should mount at the animate target,
  // not the initial. Done via the same path as the state machine's
  // `suppressFirstMount` flag below; consistent semantic across both.
  const suppressFirstMount = untrack(() => presence.initial?.()) === false
  if (!config?.initialAppliedBySSR && !suppressFirstMount && capturedInitialTarget) {
    applyStaticStyle(el, capturedInitialTarget)
  }

  // ---------- MV-in-style: register external MVs + the registry writer ----------
  // Stage 2/3 of the MV-in-style work. useMotion has scraped `MotionValue` refs
  // out of `style` (e.g., `<motion.div style={{ scale: mv }}>`) and handed
  // them to us in `config.styleMotionValues`. We register each as an external
  // entry in the registry and subscribe a single writer that rebuilds the
  // inline style from a fresh registry snapshot via `applyStaticStyle`.
  //
  // The writer is also subscribed to transient MVs Stage 3's animate bridge
  // creates on demand. Composition cost on each MV change is bounded by
  // registry size — for the common `style: { scale: mv }` case it's a single
  // transform-shortcut walk and one `el.style.transform =` write
  // (bench 04 / bench 08 — ~600 ns per subscriber).
  //
  // Bridge activation rule (Stage 3): the state machine routes animate-target
  // dispatches through the registry ONLY when at least one external MV has
  // been registered. Without a style MV, bridging is inactive and the state
  // machine falls back to the existing `animate(el, target, opts)` WAA path.
  // This keeps the 293 baseline tests on their original code path — their
  // `animateSpy.mock.calls[*][1]` assertions still see a target object.
  // ---------- Specialized writer (Stage 4.5b) ----------
  // `writeFromRegistry` is the subscription target: every MV in the registry
  // is hooked to it via `mv.on("change", writeFromRegistry)`. Internally it
  // dispatches to a `writer` closure that's COMPILED based on the registry's
  // current shape:
  //
  //   - 0 entries → noop (the registry is empty; nothing to paint)
  //   - 1 entry  → SPECIALIZED closure that captures (key, mv) in scope.
  //                Per-call cost is just mv.get() → snapshotValue → format →
  //                DOM write. No iterator allocations, no TRANSFORM_KEYS
  //                lookup, no branching on key shape — the shape is baked
  //                into the closure choice.
  //   - 2+ ents  → `multiKeyWriter`, which walks the registry, composes a
  //                Target, and runs the full applyStaticStyle path.
  //
  // The closure is recompiled by `refreshWriter()` whenever the registry's
  // size changes (called from every registration site: Stage 2 styleMV
  // loop, Stage 4 initial-target walk, Stage 4 static-transforms walk, and
  // Stage 3 `getValueForAnimate`'s transient-creation branch).
  //
  // Why this matters at scale: Sierpinski at depth 8 has 6,561 dots × one
  // style MV each = 6,561 calls per scale.set, × 60 Hz = 393k calls/sec.
  // The previous fast path allocated 3 IteratorResults per call → 1.2M
  // allocations/sec of GC pressure. The specialized closure has zero per-
  // call allocations.
  const noop = (): void => {}
  let writer: () => void = noop
  const writeFromRegistry = (): void => writer()

  const multiKeyWriter = (): void => {
    if (!valueRegistry) return
    const target: Record<string, unknown> = {}
    for (const [k, mv] of valueRegistry.entries()) {
      target[k] = mv.get()
    }
    // Layout's second-layer fold (ADR 0006). When `layoutLayer` is
    // populated, mutate `target` to compose layer values into the
    // user-facing axes BEFORE `applyStaticStyle` calls `targetToStyle`.
    // `targetToStyle` stays SSR-pure — reserved layer MVs are never
    // populated server-side.
    if (valueRegistry.hasLayoutLayer) {
      foldLayoutLayerIntoTarget(target, valueRegistry.layoutLayer)
    }
    if (Object.keys(target).length === 0) return
    applyStaticStyle(el, target as Target)
  }

  const compileSingleKeyWriter = (): (() => void) => {
    // Safe: caller guarantees size === 1.
    const [key, mv] = (valueRegistry as ValueRegistry).entries().next().value as [
      string,
      MotionValue<unknown>,
    ]
    if (TRANSFORM_KEYS.has(key)) {
      // Pre-pick the formatter so the per-call hot path skips the
      // transform-key switch entirely. Captured in the closure scope; the
      // switch happens ONCE per element at compile time, never per write.
      const formatter = pickTransformFormatter(key)
      if (formatter !== undefined) {
        return () => {
          const v = snapshotValue(mv.get())
          if (v !== undefined) el.style.transform = formatter(v)
        }
      }
    }
    if (key.startsWith("--")) {
      return () => {
        const v = snapshotValue(mv.get())
        if (v !== undefined) el.style.setProperty(key, String(v))
      }
    }
    return () => {
      const v = snapshotValue(mv.get())
      if (v === undefined) return
      const formatted = formatProperty(key, v)
      ;(el.style as unknown as Record<string, string | number>)[key] = formatted
    }
  }

  const refreshWriter = (): void => {
    const size = valueRegistry?.size ?? 0
    const hasLayer = valueRegistry?.hasLayoutLayer ?? false
    if (size === 0 && !hasLayer) {
      writer = noop
      return
    }
    // When the layout layer is active we can't use the single-key
    // specialized closure — its emission path bypasses the layer fold.
    // Fall through to multiKeyWriter so the fold runs.
    if (size === 1 && !hasLayer) {
      writer = compileSingleKeyWriter()
      return
    }
    writer = multiKeyWriter
  }
  // Bridge activates whenever the user supplied ANY registry-owned style
  // entry — an MV in style OR a static transform shortcut. The transform
  // string then becomes the registry-writer's exclusive responsibility,
  // composing from the union of (initial transforms, style MVs, static
  // style transforms, animate-target transients). With NO registry-owned
  // entries, transforms stay on the pre-existing WAA dispatch path.
  let bridgeActive = false
  if (config?.styleMotionValues && config.styleMotionValues.size > 0) {
    const registry = ensureRegistry()
    for (const [key, mv] of config.styleMotionValues) {
      registry.setExternal(key, mv)
      onCleanup(mv.on("change", writeFromRegistry))
    }
    bridgeActive = true
  }
  if (config?.styleStaticTransforms && config.styleStaticTransforms.size > 0) {
    bridgeActive = true
  }

  // ---------- Stage 4: register initial + static-style transforms as transients ----------
  // When bridging is active, ALL transform-shortcut keys need to flow through
  // the registry so the writer composes the full transform string. Animate
  // targets get routed via Stage 3's bridge (transients created on demand);
  // style MVs get registered as external in the Stage 2 block above. This block
  // closes the remaining two gaps:
  //
  //   (a) Initial transform values (from own.initial / parent.initial /
  //       own.animate / parent.animate priority chain). Without these,
  //       initial.y=20 + style.scale=mv would compose only `scale(<v>)` —
  //       initial.y would be lost when the writer fires.
  //
  //   (b) Static transform shortcuts in the user's `style` prop (e.g.,
  //       `style={{ x: 10, scale: mv }}`'s `x: 10`). These don't enter via
  //       Stage 2's MV scrape; useMotion forwards them in
  //       `styleStaticTransforms`. Same fate as (a) if not registered:
  //       composeFirstPaintStyle gets them onto the SSR HTML, but the writer
  //       wouldn't know about them on subsequent recomposes.
  //
  // Both (a) and (b) seed transients in the registry; the bridge function above
  // returns them on subsequent animate dispatches, and the writer composes
  // them with style MVs into one transform string. Non-transform initial
  // values (opacity, etc.) stay on applyStaticStyle's one-shot path — the
  // writer doesn't touch keys it doesn't own.
  //
  // We snapshot the raw value with `snapshotValue` because initial targets can
  // carry keyframe arrays, MotionValues, or accessor functions; the transient
  // needs a concrete leaf to start from. styleStaticTransforms is already
  // pre-snapshotted by useMotion.
  if (bridgeActive && capturedInitialTarget) {
    const registry = ensureRegistry()
    for (const key in capturedInitialTarget) {
      if (key === "transition") continue
      if (!TRANSFORM_KEYS.has(key)) continue
      if (registry.has(key)) continue
      const raw = (capturedInitialTarget as Record<string, unknown>)[key]
      const snapshot = snapshotValue(raw)
      if (snapshot === undefined) continue
      const mv = registry.getOrCreateTransient(key, snapshot)
      onCleanup(mv.on("change", writeFromRegistry))
    }
  }
  if (bridgeActive && config?.styleStaticTransforms) {
    const registry = ensureRegistry()
    for (const [key, value] of config.styleStaticTransforms) {
      // Static style entries WIN over initial on key collision — style is
      // the runtime source of truth for any key it specifies. Replace any
      // transient just seeded from initialTarget with this value's transient.
      const existing = registry.get(key)
      if (existing) {
        existing.set(value)
      } else {
        const mv = registry.getOrCreateTransient(key, value)
        onCleanup(mv.on("change", writeFromRegistry))
      }
    }
  }

  // Initial paint from the registry — composes initial transforms + style MVs
  // + static-style transforms into a single transform string. Skipped when
  // nothing is registered.
  if (bridgeActive) {
    // All initial registrations complete; compile the specialized writer
    // based on the final registry size before firing the first paint.
    // Subsequent transient additions (via getValueForAnimate) call
    // refreshWriter themselves.
    refreshWriter()
    writeFromRegistry()
  }

  // ---------- Stage 3 bridge function — animate target → registered MV ----------
  // Returns the MV the state machine should animate for `key`:
  //   • external (user-provided) MV in registry → return it; animate's tween
  //     drives this MV directly, and our writer composes the transform.
  //   • registry doesn't have an MV but key is a transform shortcut → create
  //     a transient MV initialized to `fallback`, subscribe the writer, return
  //     the new MV.
  //   • non-transform key with no external MV → return undefined; state machine
  //     falls back to WAA.
  // Inactive when no external MV exists — preserves the existing dispatch
  // shape end-to-end for non-MV-in-style users.
  const getValueForAnimate = (key: string, fallback: unknown): MotionValue<unknown> | undefined => {
    if (!bridgeActive) return undefined
    // `bridgeActive=true` implies the registry was ensured by one of the
    // registration blocks above, but TypeScript can't see that correlation.
    // Re-resolve through `ensureRegistry()` — idempotent and free if already
    // created.
    const registry = ensureRegistry()
    const existing = registry.get(key)
    if (existing) return existing
    if (!TRANSFORM_KEYS.has(key)) return undefined
    const mv = registry.getOrCreateTransient(key, fallback)
    onCleanup(mv.on("change", writeFromRegistry))
    // Registry size just grew — recompile the writer so the next paint uses
    // the multi-key path that composes all transforms together. (Transitions
    // 1→2 swap from specialized single-key to multiKeyWriter; 2+→N+1 stays
    // on multiKeyWriter, refreshWriter is then idempotent.)
    refreshWriter()
    return mv
  }

  // ---------- Presence-aware enter-readiness gate ----------
  // We detect "inside a real <Presence>" by the absence of `registerEnter` on
  // the no-op default context. When we ARE inside one, the element may be
  // off-DOM at the moment the state machine first iterates (the new child
  // during a mode="wait" swap is created before the old child's exit
  // settles, and even the initial child is briefly created off-DOM during
  // appear). Dispatching motion's `animate()` then would run the animation
  // on a disconnected element and silently fail commitStyles — the element
  // would paint at its `initial` target when it finally enters the DOM.
  //
  // Solution: start `enterReady = false` while in a Presence, register a
  // `runEnter` callable that flips it true, and let Presence call it from
  // its `onEnter` / `onChange.added` hook (when transition-group has
  // synchronously inserted the element via `setReturned`). Outside a
  // Presence we leave `enterReady` undefined; the state machine treats
  // absence as ready=true and the existing eager-first-iteration behavior
  // is unchanged.
  const inPresence = presence.registerEnter !== undefined
  const [enterReady, setEnterReady] = createSignal(!inPresence)
  if (inPresence && presence.registerEnter) {
    // Single source of truth for readiness: `el.isConnected`. The diff
    // effect's first iteration must NOT fire animate against a
    // disconnected element — motion's WAAPI animation runs to completion
    // off-DOM, then silently drops `commitStyles`, leaving the element
    // painted at its `initial` target with no visible transition.
    //
    // Both signals that could trip readiness are routed through this
    // function:
    //
    //   1. Presence's `beforeMount(el)` callback — fires when
    //      transition-group inserts the tracked element. For a tracked
    //      direct child of Presence, by the time this fires the element
    //      is in the DOM, so `isConnected` is true and we flip
    //      immediately. For a NESTED motion element inside a deeper
    //      Presence whose `onEnter` fires synchronously during render
    //      (while the surrounding outer-Presence-tracked subtree is
    //      STILL off-DOM in a holding pen), `isConnected` is false and
    //      we schedule a retry.
    //
    //   2. The initial-microtask fallback — for cases where Presence's
    //      `beforeMount` doesn't fire at all (e.g., a `<Presence
    //      initial={false}>` appear=false case, where transition-group
    //      doesn't raise enter for the initial source items).
    //
    // The rAF retry self-terminates the moment `setEnterReady(true)`
    // fires; the `live` flag (cleared via `onCleanup`) prevents leaks
    // if the owner is disposed before insertion ever happens.
    let live = true
    onCleanup(() => {
      live = false
    })
    const checkConnection = (): void => {
      if (!live) return
      if (el.isConnected) {
        setEnterReady(true)
        return
      }
      requestAnimationFrame(checkConnection)
    }
    presence.registerEnter(el, checkConnection)
    queueMicrotask(checkConnection)
  }

  // ---------- Gesture state machine (Q3b, ADR 0002) ----------
  // Constructed BEFORE presence registration so the registered `runExit`
  // callable can close over `setActive` + `onceExitComplete`. Owns target
  // resolution, priority winners, and the diff-and-animate loop. Returns
  // `setActive` which gesture wiring uses to toggle active flags, and
  // `onceExitComplete` which Presence awaits during unmount.
  // (For drag's typing constraint, see the createDrag call below.)
  const stateMachine = createGestureStateMachine({
    el,
    getOpts,
    parentVariantCtx,
    motionConfig,
    systemReducedMotion,
    initialTarget: capturedInitialTarget,
    externalActiveStore: config?.activeStore,
    suppressFirstMount,
    enterReady,
    getValueForAnimate,
  })
  const { setActive, onceExitComplete } = stateMachine

  // ---------- Presence registration (Phase 3 — inverted shape) ----------
  // Child registers a `runExit` callable that dispatches the exit animate
  // DIRECTLY (bypassing the state-machine effect). Direct dispatch is
  // necessary because by the time Presence's `onExit` callback fires,
  // Solid has already disposed the surrounding owner — the state machine's
  // diff effect is gone. `runExit` therefore captures the exit-relevant
  // options at construction time and uses motion's `animate()` itself.
  //
  // We do NOT call `presence.unregister(el)` on owner cleanup — that would
  // race ahead of Presence's onExit. Instead, Presence/hook unregisters
  // after the exit settles. See ADR 0003 for the timing rationale.
  // Register a runExit for this element if EITHER:
  //   (a) it has its own `exit` prop, OR
  //   (b) an ancestor's exit label cascades down via VariantContext AND this
  //       element has a `variants` map that could resolve against it.
  //
  // (b) is the motion-react canonical orchestration pattern: a parent shell
  // declares `exit: "closed"` (a label), wraps children in `m.Provider`, and
  // children are passive consumers — they have ONLY a `variants` map keyed
  // by `"closed"` (and other labels). Without (b), the children would never
  // register a runExit and Presence's subtree-walk wouldn't find them; the
  // cascade would work on enter but vanish on exit.
  //
  // The check uses parentVariantCtx.exit?.() which (per use-motion.tsx's
  // `myVariantCtx.exit`) returns the parent's exit prop unconditionally —
  // not gated on the parent's active.exit flag — so this snapshot at
  // construction sees the static cascaded label, not a transient runtime
  // value.
  const inheritedExitLabel = untrack(() => parentVariantCtx.exit?.())
  const hasOwnExit = initialOpts.exit !== undefined
  const hasCascadedExit = inheritedExitLabel !== undefined && initialOpts.variants !== undefined

  if (hasOwnExit || hasCascadedExit) {
    const runExit = async (): Promise<void> => {
      // Re-read opts at exit time. The previous design snapshotted them at
      // construction, which broke any pattern where `exit` is reactive — a
      // swipe-card whose exit direction depends on which way the user just
      // flicked, for example, would always exit using the PREVIOUS card's
      // direction (the value that was live when THIS card mounted). We
      // untrack the read because we don't want to subscribe anything that
      // would still be alive after the surrounding owner has been disposed
      // by Solid's `<Show>` / `<For>` swap. The props proxy itself survives
      // disposal — it's just a JS object that the runExit closure keeps
      // referenced — so reading `props.X` here returns the latest value
      // the parent passed in.
      const opts = untrack(getOpts)
      // `resolveTarget` walks own.exit, then the inherited cascade. When
      // neither produces a target there's nothing to animate — return
      // without setActive so we don't hang on the (potentially dead)
      // state machine's onceExitComplete.
      const exitTarget = resolveTarget(
        opts.exit,
        opts.variants,
        asVariantLabels(untrack(() => parentVariantCtx.exit?.())),
        opts.custom ?? parentVariantCtx.custom?.(),
      )
      if (!exitTarget) {
        // Resolved to null (e.g., the user passed a label that doesn't
        // exist in variants). Cooperate with the state machine for cases
        // where the user expects an "exit" gesture without specific keys.
        setActive("exit", true)
        await onceExitComplete()
        return
      }

      // Merge transition: MotionConfig default < user.transition <
      // exit-target.transition < reduced-motion override.
      const reduced = shouldReduceMotion(motionConfig.reducedMotion(), systemReducedMotion())
      const transition = mergeTransition(
        motionConfig.transition(),
        opts.transition,
        exitTarget.transition,
        reduced,
      )

      // Strip `transition` from the target before passing to animate.
      const animTarget: Record<string, unknown> = {}
      for (const k in exitTarget) {
        if (k !== "transition") {
          animTarget[k] = (exitTarget as Record<string, unknown>)[k]
        }
      }

      // biome-ignore lint/suspicious/noExplicitAny: motion's animate has a complex overloaded shape we can't tighten generically; the runtime call is correct.
      const controls = animate(el, animTarget as any, transition as any)
      // AnimationPlaybackControls is thenable at runtime (motion 12.x).
      // The public type doesn't expose `.then` — narrow via PromiseLike.
      await (controls as unknown as PromiseLike<unknown>)
    }

    presence.register(el, runExit)
    // No `onCleanup(() => presence.unregister(el))` — that would fire
    // synchronously when Solid disposes the child's owner, BEFORE
    // transition-group's `onExit` callback runs. Presence/hook calls
    // `unregister` itself after the exit settles. For the no-op default
    // context (no enclosing Presence), `register` is a silent drop —
    // nothing to clean up.
  }

  // ---------- Pointer-event gestures (hover, press, focus, inView) ----------
  // Listeners attach unconditionally on mount; the state machine no-ops when
  // an active state has no target.
  createGestures(el, getOpts, setActive)

  // ---------- Drag + pan (Q5/C-lean + Q11/D3) ----------
  // createDrag layers on createPan for the pointer session and writes to the
  // element's VisualElement x/y MotionValues during drag. Drag is HTML-only
  // for v0.1 — motion-dom's HTMLVisualElement is HTML-specific. Users who
  // wire `drag` onto an SVG element get a no-op at construction; we could
  // surface a dev warning here later if needed.
  if (el instanceof HTMLElement) {
    createDrag(el, getOpts, setActive)
  }

  // ---------- Layout (0.2.0 — controller + layoutId handoff) ----------
  // Snapshot `opts.layout` / `opts.layoutId` at construction; reactive
  // toggle-off is the Q8/risk #4 polish, deferred to its own step.
  // Bridging the controller into the registry-write path requires
  // `bridgeActive = true` so the writer composes the layer's transform
  // contribution — without this the writer stays on its no-op default
  // and the FLIP visual never paints. Force activation by ensuring the
  // registry exists and the writer recompiles when the layer's shape
  // changes (via the controller's `refreshWriter` callback).
  if (initialOpts.layout || initialOpts.layoutId !== undefined) {
    ensureRegistry()
    bridgeActive = true
    refreshWriter()

    // layoutId consume — if this element donates/receives a shared-
    // element transition, find the previous holder of this id and FLIP
    // from its rect. Two sources, checked in order:
    //
    //   1. A LIVE sibling already mounted under the same layoutId
    //      (`findLive`). This is the common case under `<Presence>`
    //      keep-alive (donor still in DOM, awaiting exit) and under
    //      same-tick `<Show>`/route swaps where the consumer mounts
    //      BEFORE the donor's `onCleanup` fires. We read the donor's
    //      CURRENT `getBoundingClientRect()` — the visually-accurate
    //      "First" — and use it as the consumer's first rect.
    //
    //   2. A queued `donate(...)` entry (`consume`), populated by the
    //      previous holder's onCleanup. This handles the case where
    //      the donor has already detached from the DOM by the time
    //      the consumer mounts (no Presence, cross-tick handoff).
    //
    // See ADR 0007 and Plan §6.
    const layoutIdAtMount = initialOpts.layoutId
    let initialFirst: { x: number; y: number; width: number; height: number } | undefined
    if (layoutIdAtMount !== undefined) {
      // Track A path: look for a still-mounted sibling under this id.
      const liveDonor = layoutGroupContext.coordinator.findLive(layoutIdAtMount, el)
      if (liveDonor !== null) {
        const donorRect = liveDonor.getBoundingClientRect()
        const consumerProjParent = projectionContext.parentEl()
        const P = consumerProjParent.getBoundingClientRect()
        initialFirst = {
          x: donorRect.left - P.left,
          y: donorRect.top - P.top,
          width: donorRect.width,
          height: donorRect.height,
        }
      } else {
        // Fall back to the donate queue (cross-tick handoff path).
        const entry = layoutGroupContext.coordinator.consume(layoutIdAtMount)
        if (entry !== null) {
          const donorRect = entry.el.isConnected ? entry.el.getBoundingClientRect() : entry.rect
          const consumerProjParent = projectionContext.parentEl()
          const P = consumerProjParent.getBoundingClientRect()
          initialFirst = {
            x: donorRect.left - P.left,
            y: donorRect.top - P.top,
            width: donorRect.width,
            height: donorRect.height,
          }
        }
      }

      // Register THIS element under the layoutId so a future consumer
      // can find it via `findLive`. Done AFTER the lookup above so we
      // don't find ourselves (defensive — `findLive` already excludes
      // `self`, but registering after also keeps the registry's
      // intent clear).
      layoutGroupContext.coordinator.register(layoutIdAtMount, el)
    }

    createLayoutController(el, getOpts, {
      registry: ensureRegistry(),
      refreshWriter,
      writeFromRegistry,
      projectionContext,
      layoutGroupContext,
      motionConfig,
      systemReducedMotion,
      initialFirst,
    })

    // layoutId donate — at owner-dispose time, capture this element's
    // rect + projection-parent rect and deposit them in the
    // coordinator. The locked timing (Q5): `onCleanup` runs
    // synchronously when Solid disposes the owner, BEFORE any exit
    // animation. Inside `<Presence>` the element stays in the DOM
    // (transition-group keep-alive), so `el.getBoundingClientRect()`
    // returns the donor's pre-exit rect at this moment.
    //
    // Registered AFTER `createLayoutController` (which registers its
    // own onCleanup) so donate fires FIRST in LIFO order — captures
    // the rect before the controller clears the layer.
    if (layoutIdAtMount !== undefined) {
      onCleanup(() => {
        // Re-read layoutId via untrack — in case it's reactive and
        // changed since mount. Skip donation when there's no id
        // (e.g., flipped to undefined by the time of unmount).
        const liveLayoutId = untrack(getOpts).layoutId ?? layoutIdAtMount
        if (liveLayoutId === undefined) return

        // Unregister from the live registry FIRST. Without this, a
        // same-tick consumer's `findLive` could return THIS element
        // even though it's about to be removed — leading the consumer
        // to FLIP from its own pre-unmount position rather than from
        // a meaningful donor.
        layoutGroupContext.coordinator.unregister(liveLayoutId, el)

        const projParent = projectionContext.parentEl()
        const rect = el.getBoundingClientRect()
        const projRect = projParent.getBoundingClientRect()
        layoutGroupContext.coordinator.donate(liveLayoutId, {
          el,
          rect,
          projectionParentRect: projRect,
        })
      })
    }
  }
}

// Re-export for useMotion to consume the same helpers without circular deps.
export { applyStaticStyle }
