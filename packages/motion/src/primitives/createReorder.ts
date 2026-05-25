// ---------------------------------------------------------------------------
// createReorder — drag-driven list-reorder primitive (Plan §3, ADR 0008).
//
// Public shape (inverted composition):
//
//   const reorder = createReorder(values, setValues, { axis: "y" })
//   <ul ref={reorder.group.ref}>
//     <For each={values()}>
//       {(item) => {
//         const m = reorder.item(item, () => ({ animate: {...} }))
//         return <li {...m()}>{item}</li>
//       }}
//     </For>
//   </ul>
//
// `item(value, motionOptions)` calls useMotion internally with reorder-locked
// fields merged OVER the caller's motionOptions — silent override prevents
// users from accidentally breaking reorder semantics by passing a conflicting
// `drag`, `layout`, `dragSnapToOrigin`, or `dragMomentum`. Composed
// onDragStart / onDrag / onDragEnd drive the center-cross math; user-supplied
// versions still fire (their callback runs before the primitive's).
//
// Drag-suppressed layout (the `whileDrag` gate inside createLayoutController)
// keeps the dragged item's own FLIP from fighting the pointer-driven drag
// transform. Siblings — not dragging — FLIP normally into their new slots.
// ---------------------------------------------------------------------------

import { visualElementStore } from "motion-dom"
import type { Accessor } from "solid-js"
import { createComputed, createSignal, on, onCleanup } from "solid-js"

import type {
  ElementProps,
  MotionElement,
  MotionGetProps,
  MotionMergedProps,
  MotionOptions,
  PanInfo,
  ReorderOptions,
} from "../types"
import { useMotion } from "../use-motion"

/**
 * Return value of {@link createReorder}.
 */
export type ReorderResult<T> = {
  /**
   * Wiring for the group's container element. Spread `ref` onto the
   * container (`<ul ref={reorder.group.ref}>…`). Kept for forward
   * compatibility — v1 has no behavior depending on the group element,
   * but features in 0.3.x (auto-scroll near edges, drag bounds scoped
   * to the container) will land here without an API change.
   */
  group: {
    ref: (el: HTMLElement) => void
  }
  /**
   * Per-item factory. Pass the value from the `values()` array and an
   * optional MotionOptions payload (animation / transition / gesture
   * variants the caller wants — including `dragListener` / `dragControls`
   * for handle composition). Returns the same callable shape that
   * `useMotion` returns — spread `m()` directly onto the JSX element.
   *
   * Reorder-controlled fields silently override the caller's motion
   * options:
   * - `layout: true`
   * - `drag: <configured axis>`
   * - `dragSnapToOrigin: true`
   * - `dragMomentum: false`
   *
   * `onDragStart`, `onDrag`, `onDragEnd` are composed — the caller's
   * callback runs first, then the primitive's center-cross handler.
   *
   * Identity model: `value` is the array entry by reference identity,
   * the same convention as `<For each={values}>`. Duplicate values
   * collapse onto a single registry entry — see ADR 0008 §3.2.
   */
  item: (
    value: T,
    motionOptions?: MotionOptions | Accessor<MotionOptions>,
  ) => MotionGetProps
  /**
   * The value of the item currently being dragged, or `null` when no
   * drag is active. Tracks the `onDragStart` → `onDragEnd` lifecycle
   * of items wired through {@link item}.
   *
   * Useful for rendering drop-zone indicators, disabling other UI
   * during a drag, or asserting drag-lifecycle behavior in tests.
   */
  dragging: Accessor<T | null>
}

/**
 * Build a reorder context owning the pointer + center-cross logic for a
 * list. The primitive does not own the array — the caller does. The
 * primitive mutates the array via `setValues` as items cross sibling
 * centers during a drag.
 *
 * @param values — the current list. Accepts either an `Accessor<T[]>`
 *   (`createSignal` form) or a `T[]` directly (`createStore` form —
 *   `store.items` is a reactive proxy that isn't itself a function).
 *   Both forms track reactivity correctly.
 * @param setValues — setter for the list. Accepts any function with
 *   the shape `(next: T[]) => void`. Solid's `Setter<T[]>` from
 *   `createSignal` is structurally compatible (its `T[]` return is
 *   assignable to `void`). For `createStore` use a wrapper:
 *   `(next) => setStore("items", next)`. Set-by-path SetStoreFunction
 *   variants (e.g., passing `setStore` directly when `T[]` is the top-
 *   level store shape) are NOT a direct match — wrap them.
 * @param options — group-level config. Accepts a static object or an
 *   accessor for reactive option changes.
 *
 * Mutation-detection (used by `cancelOnExternalReorder` and the
 * dragged-item-removed-mid-drag abort) is via re-entrancy flag rather
 * than reference identity, so it works for both `createSignal` and
 * `createStore` (including `setStore(produce(...))` in-place
 * mutations where the array reference is stable).
 *
 * @example createSignal
 * ```tsx
 * const [items, setItems] = createSignal(["a", "b", "c"])
 * const reorder = createReorder(items, setItems, { axis: "y" })
 * ```
 *
 * @example createStore
 * ```tsx
 * const [store, setStore] = createStore({ items: ["a", "b", "c"] })
 * const reorder = createReorder(
 *   store.items,
 *   (next) => setStore("items", next),
 *   { axis: "y" },
 * )
 * ```
 */
export function createReorder<T>(
  values: Accessor<T[]> | T[],
  // `NoInfer` (TS 5.4+) — when the caller passes a complex overloaded
  // function here (notably Solid's `SetStoreFunction<Task[]>`), the
  // compiler can pick a path-based overload that resolves T to the
  // index-key type (`number`) instead of the item type. NoInfer tells
  // TypeScript: don't use this parameter for T inference — infer T
  // solely from `values`.
  setValues: (next: NoInfer<T>[]) => void,
  options?: ReorderOptions | Accessor<ReorderOptions>,
): ReorderResult<T> {
  // ---------- Reactive option resolution ----------
  const getOpts: () => ReorderOptions =
    typeof options === "function" ? options : () => options ?? {}
  const axisOf = (): "x" | "y" => getOpts().axis ?? "y"
  const cancelOnExternal = (): boolean => getOpts().cancelOnExternalReorder ?? false

  // ---------- Values normalization (Accessor<T[]> | T[]) ----------
  // Accept either an accessor (createSignal-style) or a direct value
  // (createStore-style — `store.items` is a reactive proxy that's not
  // itself a function). Normalize to an accessor for internal use; the
  // wrapper `() => values` reads the captured value on each call, which
  // tracks fine-grained property reads on store proxies and re-evaluates
  // accessor calls.
  const valuesAccessor: Accessor<T[]> =
    typeof values === "function" ? (values as Accessor<T[]>) : () => values

  // ---------- Registry & snapshot state ----------
  /** Per-value element registry. Populated by each item's composed ref. */
  const elementByValue = new Map<T, HTMLElement>()

  /** Per-value bcr snapshot. Refreshed at drag start and after each swap. */
  const bcrSnapshot = new Map<T, DOMRect>()

  const [draggingSig, setDraggingSig] = createSignal<T | null>(null)

  // ---------- Drag-session state (set on onDragStart, cleared on onDragEnd) ----------
  let activeValue: T | null = null
  let activeAxis: "x" | "y" | null = null
  let activeElement: HTMLElement | null = null
  /** Pointer id from the original pointerdown — captured at onDragStart so
   * `abortDrag` can synthesize a pointercancel that motion-dom's pan
   * pipeline accepts (createPan checks `event.pointerId === pointerId`). */
  let activePointerId: number | null = null
  /** Dragged item's bcr captured at onDragStart — frozen for the session.
   * Center-cross math uses this as the dragged item's "origin" so the
   * pointer-tracking center stays continuous across mid-drag reorders. */
  let draggedStartRect: DOMRect | null = null
  /** Cumulative layout shift the dragged item has experienced from swaps
   * (along the active axis). Every onDrag subtracts this from the drag
   * MV so the dragged item's VISUAL position stays under the pointer
   * even after its DOM slot has moved. Without this compensation,
   * motion-dom's drag pipeline computes `mv = dragStart + info.offset`
   * from the ORIGINAL slot, so post-swap the visual jumps ahead of the
   * pointer by the slot delta. See ADR 0008 follow-up notes. */
  let cumulativeLayoutDelta = 0
  /** Saved inline `position` and `z-index` of the dragged element so we
   * can promote it to a higher stacking context for the drag duration
   * and restore the user's original styles on drag-end. Required because
   * `layout: true` siblings all share the parent stacking context and
   * paint in DOM order — without an explicit `z-index` boost the dragged
   * item would paint UNDER siblings later in the array. */
  let savedStyles: { zIndex: string; position: string } | null = null
  /** Per-value layout slot center along the active axis. Initialized from
   * the drag-start snapshot, updated via swap arithmetic on each
   * crossing — never re-derived from `getBoundingClientRect()` after
   * drag-start. This sidesteps the timing problem where post-swap bcrs
   * may include in-flight FLIP transforms (siblings from previous swaps
   * still animating) or stale drag transforms (motion-dom's transform
   * writer may not have applied the latest MV yet). The map is exact
   * for equal-height items; variable-height items are approximate
   * (slot center swap is symmetric, but actual layout deltas depend on
   * each item's height — a follow-up can refine that math). */
  let slotCenterByValue: Map<T, number> | null = null

  // ---------- External-mutation detection ----------
  /** True while we're inside `internalSetValues` — the values-watcher
   * uses this re-entrancy flag (rather than reference identity) to
   * recognise its own writes. createComputed runs SYNCHRONOUSLY during
   * the signal/store update propagation, so the flag is still set when
   * the watcher's callback fires.
   *
   * Why not reference identity (the previous approach): for
   * createStore-backed lists, `setStore(produce(...))` mutates in place
   * — the proxy reference is stable across mutations, so identity
   * comparison can't distinguish own writes from external ones. The
   * flag is who-made-the-call detection, which works regardless of
   * value-shape semantics. */
  let isInternalWrite = false
  /** Set by the values-watcher when an external mutation invalidates the
   * snapshot; the next onDrag re-snapshots before running center-cross. */
  let snapshotStale = false

  // ---------- Helpers ----------
  function centerOf(rect: DOMRect, ax: "x" | "y"): number {
    return ax === "y" ? rect.top + rect.height / 2 : rect.left + rect.width / 2
  }

  function snapshotAll(): void {
    bcrSnapshot.clear()
    // Real browsers: offsetTop/Left/Width/Height return the element's
    // CSS-box layout position EXCLUDING all transforms. This is exactly
    // what we need for the slot-center map:
    //   - excludes the active drag transform on the dragged item,
    //   - excludes any in-flight FLIP transforms on siblings (from a
    //     prior drag whose layout animations haven't settled yet — the
    //     jankiness you'd see if we used getBoundingClientRect here).
    //
    // JSDOM (tests): doesn't compute layout, so offsetWidth returns 0.
    // Fall back to getBoundingClientRect — test stubs install bcrs
    // directly, and the FLIP-in-flight scenario this offset path
    // protects against doesn't arise in JSDOM (no real animations).
    //
    // All items share the same offsetParent (the group's container or
    // its nearest positioned ancestor), so offsetTop/Left are mutually
    // comparable across items in the same Reorder.Group.
    for (const [v, el] of elementByValue) {
      const hasLayout = el.offsetWidth > 0 || el.offsetHeight > 0
      const rect = hasLayout
        ? new DOMRect(el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight)
        : el.getBoundingClientRect()
      bcrSnapshot.set(v, rect)
    }
    snapshotStale = false
  }

  function internalSetValues(next: T[]): void {
    isInternalWrite = true
    try {
      setValues(next)
    } finally {
      isInternalWrite = false
    }
  }

  function abortDrag(): void {
    if (activePointerId === null) return
    // Synthesizing a pointercancel routes through motion-dom's pan/drag
    // pipeline (createPan handles pointercancel like pointerup-without-end,
    // firing onPanEnd → createDrag's handlePanEnd → user/composed onDragEnd
    // → whileDrag flips false → dragSnapToOrigin engages). The original
    // pointerId must match what motion-dom captured at pointerdown —
    // createPan rejects pointercancels with a mismatched id.
    //
    // Dispatch on window: motion-dom's pan registers its move/up/cancel
    // listeners on window (not on the dragged element), AND the dragged
    // element may already be detached from the DOM by the time abortDrag
    // fires (the most common path — external setValues removed the value
    // and its For-row owner disposed the element). A detached element
    // wouldn't bubble events to window.
    try {
      window.dispatchEvent(
        new PointerEvent("pointercancel", {
          pointerId: activePointerId,
          bubbles: true,
        }),
      )
    } catch {
      // PointerEvent constructor unavailable (rare; old jsdom, non-browser).
      // Drag state will clear on the next genuine pointerup.
    }
  }

  // ---------- External-mutation watcher ----------
  // createComputed runs synchronously after each `values` write — earlier
  // than createEffect, so the snapshot/cancel decision lands before any
  // dependent UI render. `defer: true` skips the initial run; the watcher
  // is dormant until a value-change actually occurs.
  createComputed(
    on(
      valuesAccessor,
      (next) => {
        if (activeValue === null) return
        // Our own write — the re-entrancy flag is still true because
        // createComputed runs synchronously within `internalSetValues`'s
        // call to `setValues`. Bail without touching state.
        if (isInternalWrite) {
          return
        }
        // External write: dragged item gone → abort hard.
        if (next.indexOf(activeValue) < 0) {
          abortDrag()
          return
        }
        // External write: strict mode → abort.
        if (cancelOnExternal()) {
          abortDrag()
          return
        }
        // External write: lenient mode → re-measure on next onDrag.
        snapshotStale = true
      },
      { defer: true },
    ),
  )

  // ---------- Drag lifecycle ----------
  function rebuildSlotCenters(): void {
    if (activeAxis === null) {
      slotCenterByValue = null
      return
    }
    const map = new Map<T, number>()
    for (const [v, rect] of bcrSnapshot) {
      map.set(v, centerOf(rect, activeAxis))
    }
    slotCenterByValue = map
  }

  function handleDragStart(value: T, event: PointerEvent): void {
    activeValue = value
    activeAxis = axisOf()
    activeElement = elementByValue.get(value) ?? null
    activePointerId = event.pointerId
    cumulativeLayoutDelta = 0
    setDraggingSig(() => value)
    snapshotAll()
    draggedStartRect = bcrSnapshot.get(value) ?? null
    // Initial slot centers from the drag-start snapshot. From this point
    // on, slotCenterByValue is updated only via swap arithmetic — never
    // re-derived from bcr — so transform-write timing doesn't matter.
    rebuildSlotCenters()

    // Promote the dragged element so it paints above siblings during the
    // drag. `position: relative` only kicks in when the computed style
    // is `static` (don't clobber `absolute`/`fixed`/`sticky` users have
    // chosen deliberately). `z-index: 1000` is high enough to win against
    // typical card stacks without escaping a portal.
    if (activeElement !== null) {
      savedStyles = {
        zIndex: activeElement.style.zIndex,
        position: activeElement.style.position,
      }
      const computedPos = window.getComputedStyle(activeElement).position
      if (computedPos === "static") {
        activeElement.style.position = "relative"
      }
      activeElement.style.zIndex = "1000"
    }
  }

  function handleDrag(value: T, info: PanInfo): void {
    if (activeValue !== value || activeAxis === null) return
    if (snapshotStale) {
      snapshotAll()
      // Rebuild the slot center map from the fresh bcrs. The dragged item's
      // bcr had its drag-transform offset stripped inside snapshotAll, and
      // siblings' bcrs may include in-flight FLIP transforms (acceptable
      // approximation — external mutations during a drag are corner cases).
      rebuildSlotCenters()
    }
    if (draggedStartRect === null || slotCenterByValue === null) return

    const ax = activeAxis
    const offsetAlongAxis = ax === "y" ? info.offset.y : info.offset.x
    // Pointer position along axis = original slot center + cumulative drag.
    // Frozen draggedStartRect keeps this stable across mid-drag reorders.
    const draggedCenter = centerOf(draggedStartRect, ax) + offsetAlongAxis

    // Center-cross loop — handles fast drags crossing multiple siblings
    // in one onDrag tick. All slot centers come from `slotCenterByValue`,
    // which is updated purely via swap arithmetic — never re-derived from
    // bcr after drag-start. This eliminates the timing dependency on
    // motion-dom's transform writer and on in-flight sibling FLIPs.
    let didSwap = true
    while (didSwap) {
      didSwap = false
      const currentArray = valuesAccessor()
      const draggedIndex = currentArray.indexOf(value)
      if (draggedIndex < 0) return // dragged item externally removed mid-iter

      const currentSlotCenter = slotCenterByValue.get(value)
      if (currentSlotCenter === undefined) return

      const direction = draggedCenter > currentSlotCenter ? 1 : -1
      const neighborIndex = draggedIndex + direction
      if (neighborIndex < 0 || neighborIndex >= currentArray.length) break

      const neighborValue = currentArray[neighborIndex] as T
      const neighborCenter = slotCenterByValue.get(neighborValue)
      if (neighborCenter === undefined) break

      const crossed =
        direction > 0
          ? draggedCenter > neighborCenter
          : draggedCenter < neighborCenter

      if (crossed) {
        // Layout delta = how far the dragged item's slot center moves.
        // For equal-height items (v1 demo case), the dragged item swaps
        // INTO the neighbor's old slot — so its new center IS the
        // neighbor's old center, exact. Swap the two values' slot
        // entries in the map so subsequent iterations / frames see
        // each item at the slot it now occupies.
        cumulativeLayoutDelta += neighborCenter - currentSlotCenter
        slotCenterByValue.set(value, neighborCenter)
        slotCenterByValue.set(neighborValue, currentSlotCenter)

        const swapped = currentArray.slice()
        swapped[draggedIndex] = neighborValue
        swapped[neighborIndex] = value
        internalSetValues(swapped)

        didSwap = true
      }
    }

    // Visual-continuity compensation. motion-dom's handlePan writes
    //   mv = dragStartX + info.offset.axis
    // every frame, which is anchored to the slot the item occupied at
    // pointerdown. As we mutate values() and the DOM reorders, the
    // dragged item's layout slot moves but `dragStartX` doesn't —
    // composed `visual = slot + mv` would jump by the cumulative slot
    // delta. Subtract that delta from the MV here (we run AFTER
    // handlePan via the composed onDrag chain) so:
    //   visual = newSlot + (mv - delta) = newSlot + originalSlotMv - delta
    //          = originalSlot + originalSlotMv = pointer position. ✓
    if (cumulativeLayoutDelta !== 0 && activeElement !== null) {
      // visualElementStore is populated by motion-dom's createMotion
      // setup. Tests mock it as an empty WeakMap, so this branch is a
      // no-op there — the test stubs don't change layout on swap, so the
      // compensation isn't observable anyway.
      const ve = visualElementStore.get(activeElement)
      if (ve !== undefined) {
        const mv = ve.getValue(ax, 0)
        mv.set(mv.get() - cumulativeLayoutDelta)
      }
    }
  }

  function handleDragEnd(value: T): void {
    if (activeValue !== value) return
    // Restore inline styles before clearing the element reference.
    // Empty string for either field reverts to whatever CSS classes /
    // computed style would resolve to (i.e., no inline override).
    if (activeElement !== null && savedStyles !== null) {
      activeElement.style.zIndex = savedStyles.zIndex
      activeElement.style.position = savedStyles.position
      savedStyles = null
    }
    activeValue = null
    activeAxis = null
    activeElement = null
    activePointerId = null
    draggedStartRect = null
    cumulativeLayoutDelta = 0
    slotCenterByValue = null
    setDraggingSig(() => null)
    bcrSnapshot.clear()
  }

  // ---------- Compose user + our callbacks ----------
  function compose<A extends unknown[]>(
    user: ((...args: A) => void) | undefined,
    own: (...args: A) => void,
  ): (...args: A) => void {
    return (...args: A): void => {
      user?.(...args)
      own(...args)
    }
  }

  // ---------- Public API ----------
  return {
    group: {
      // v1: no behavior. Held for API stability so 0.3.x features
      // (auto-scroll near edges, drag bounds scoped to the container)
      // can attach here without changing the surface.
      ref: (_el: HTMLElement): void => {},
    },
    item: (
      value: T,
      motionOptions?: MotionOptions | Accessor<MotionOptions>,
    ): MotionGetProps => {
      const getUserOpts: () => MotionOptions =
        typeof motionOptions === "function"
          ? motionOptions
          : () => motionOptions ?? {}

      const mergedOpts: () => MotionOptions = () => {
        const u = getUserOpts()
        return {
          ...u,
          // Reorder-locked fields — silently override caller.
          layout: true,
          drag: axisOf(),
          dragSnapToOrigin: true,
          dragMomentum: false,
          // Composed callbacks — caller's runs first.
          onDragStart: compose(u.onDragStart, (e: PointerEvent) =>
            handleDragStart(value, e),
          ),
          onDrag: compose(u.onDrag, (_e: PointerEvent, info: PanInfo) =>
            handleDrag(value, info),
          ),
          onDragEnd: compose(u.onDragEnd, () => handleDragEnd(value)),
        }
      }

      const m = useMotion(mergedOpts)

      // Owner-scoped cleanup: drops the value from registry/snapshot when
      // this item's owner (a `<For>` row) disposes — i.e., when the value
      // leaves `values()`.
      onCleanup(() => {
        elementByValue.delete(value)
        bcrSnapshot.delete(value)
      })

      // Wrap m's callable to compose refs: motion's ref runs first (so the
      // visual element registers in visualElementStore), then ours records
      // the HTML element for our per-value registry.
      const wrappedFn = <P extends ElementProps>(
        userProps?: P,
      ): MotionMergedProps<P> => {
        const motionProps = m(userProps)
        const motionRef = motionProps.ref
        return {
          ...motionProps,
          ref: (el: MotionElement): void => {
            motionRef(el)
            if (el instanceof HTMLElement) {
              elementByValue.set(value, el)
            }
          },
        } as MotionMergedProps<P>
      }

      return wrappedFn as MotionGetProps
    },
    dragging: draggingSig,
  }
}
