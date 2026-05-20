import { type MotionValue, motionValue } from "motion"

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

export type ValueRegistry = {
  /** Returns the MV registered for `key`, or `undefined` if none. */
  get(key: string): MotionValue<unknown> | undefined
  /** Has any MV been registered for `key`? */
  has(key: string): boolean
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
}

export function createValueRegistry(): ValueRegistry {
  const values = new Map<string, MotionValue<unknown>>()
  const transient = new Set<MotionValue<unknown>>()

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
    dispose() {
      transient.clear()
      values.clear()
    },
  }
}
