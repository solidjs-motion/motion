// ---------------------------------------------------------------------------
// LayoutCoordinator — broker for `layoutId` handoff between donor (unmounting)
// and consumer (mounting) motion elements. See ADR 0007 and Plan §6.
//
// The module-level `rootLayoutCoordinator` is the implicit-root singleton:
// `layoutId` elements not wrapped in an explicit `<LayoutGroup>` use it.
// `<LayoutGroup>` (step 6) allocates a fresh coordinator and provides it
// through `LayoutGroupContext`, shadowing the root for its subtree.
//
// HMR caveat (Q12 design lock). In user-app HMR (editing app code),
// `solidjs-motion`'s modules don't reload — the singleton survives, and
// stale entries drain via RAF cleanup. When THIS module reloads during
// library-internals HMR (editing solidjs-motion source with examples/basic
// running), existing `createMotion` instances hold refs to the OLD
// coordinator while new mounts get the NEW one — cross-instance handoff
// is broken until a full page refresh. Library-dev edge case; not a
// user-app concern.
// ---------------------------------------------------------------------------

import type { LayoutCoordinator, LayoutEntry } from "./types"

/**
 * Factory for a fresh {@link LayoutCoordinator}. `<LayoutGroup>` calls
 * this to allocate a per-group instance. The module-level
 * `rootLayoutCoordinator` is created by calling this once at module
 * load.
 *
 * Entry lifetime: from the moment of `donate(...)`, an entry survives
 * for AT MOST one RAF tick that fully elapses without consumption.
 * Same-tick handoffs (donor and consumer in the same Solid flush) are
 * the common case and always succeed. Cross-RAF handoffs without a
 * surrounding `<Presence>` are an expected miss — Presence is the
 * documented mechanism for keeping a donor alive long enough for a
 * cross-paint consumer to find it.
 */
export function createLayoutCoordinator(): LayoutCoordinator {
  const entries = new Map<string, LayoutEntry>()
  // Entries marked at the START of the current RAF window. The RAF
  // callback drops only these — donations made WITHIN the window are
  // not marked yet, so they survive into the next window's marking
  // phase. Effect: every entry lives at least one RAF after donation.
  const staleKeys = new Set<string>()
  let cleanupScheduled = false

  function scheduleCleanup(): void {
    if (cleanupScheduled) return
    cleanupScheduled = true
    for (const key of entries.keys()) staleKeys.add(key)
    requestAnimationFrame(() => {
      cleanupScheduled = false
      for (const key of staleKeys) entries.delete(key)
      staleKeys.clear()
      // If any entries remain — donated AFTER the current cleanup was
      // scheduled — register another cleanup so they don't leak forever.
      // Bounds every entry's lifetime to at most 2 RAF ticks after
      // donation regardless of when within the RAF window it was donated.
      if (entries.size > 0) scheduleCleanup()
    })
  }

  return {
    donate(layoutId, entry) {
      entries.set(layoutId, entry)
      scheduleCleanup()
    },
    consume(layoutId) {
      const entry = entries.get(layoutId) ?? null
      if (entry !== null) {
        entries.delete(layoutId)
        // Remove from staleKeys too so the next RAF doesn't try to
        // delete an already-consumed entry. Pure efficiency; correctness
        // is unaffected (deleting a missing key is a no-op).
        staleKeys.delete(layoutId)
      }
      return entry
    },
  }
}

/**
 * The implicit-root coordinator — used for `layoutId` elements not
 * wrapped in an explicit `<LayoutGroup>`. Module-level singleton;
 * see HMR caveat in this file's header comment.
 */
export const rootLayoutCoordinator: LayoutCoordinator = createLayoutCoordinator()
