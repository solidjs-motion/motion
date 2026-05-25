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

import type { Accessor, Setter } from "solid-js"
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
 * @param values — accessor for the current list.
 * @param setValues — setter for the list. The primitive replaces the
 *   array with a new reference on each crossing (Solid identity rules).
 * @param options — group-level config. Accepts a static object or an
 *   accessor for reactive option changes.
 *
 * @example
 * ```tsx
 * function ItemList() {
 *   const [items, setItems] = createSignal(["a", "b", "c"])
 *   const reorder = createReorder(items, setItems, { axis: "y" })
 *   return (
 *     <ul ref={reorder.group.ref}>
 *       <For each={items()}>
 *         {(item) => {
 *           const m = reorder.item(item)
 *           return <li {...m()}>{item}</li>
 *         }}
 *       </For>
 *     </ul>
 *   )
 * }
 * ```
 */
export function createReorder<T>(
  values: Accessor<T[]>,
  setValues: Setter<T[]>,
  options?: ReorderOptions | Accessor<ReorderOptions>,
): ReorderResult<T> {
  // ---------- Reactive option resolution ----------
  const getOpts: () => ReorderOptions =
    typeof options === "function" ? options : () => options ?? {}
  const axisOf = (): "x" | "y" => getOpts().axis ?? "y"
  const cancelOnExternal = (): boolean => getOpts().cancelOnExternalReorder ?? false

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

  // ---------- External-mutation detection ----------
  /** The array reference the primitive just wrote (via internalSetValues).
   * The values-watcher uses reference identity to skip processing
   * primitive-originated updates. */
  let expectedNext: T[] | null = null
  /** Set by the values-watcher when an external mutation invalidates the
   * snapshot; the next onDrag re-snapshots before running center-cross. */
  let snapshotStale = false

  // ---------- Helpers ----------
  function centerOf(rect: DOMRect, ax: "x" | "y"): number {
    return ax === "y" ? rect.top + rect.height / 2 : rect.left + rect.width / 2
  }

  function snapshotAll(): void {
    bcrSnapshot.clear()
    for (const [v, el] of elementByValue) {
      bcrSnapshot.set(v, el.getBoundingClientRect())
    }
    snapshotStale = false
  }

  function internalSetValues(next: T[]): void {
    expectedNext = next
    setValues(next)
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
      values,
      (next) => {
        if (activeValue === null) return
        // Our own write — drain expectedNext and bail.
        if (next === expectedNext) {
          expectedNext = null
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
  function handleDragStart(value: T, event: PointerEvent): void {
    activeValue = value
    activeAxis = axisOf()
    activeElement = elementByValue.get(value) ?? null
    activePointerId = event.pointerId
    setDraggingSig(() => value)
    snapshotAll()
    draggedStartRect = bcrSnapshot.get(value) ?? null
  }

  function handleDrag(value: T, info: PanInfo): void {
    if (activeValue !== value || activeAxis === null) return
    if (snapshotStale) snapshotAll()
    if (draggedStartRect === null) return

    const ax = activeAxis
    const offsetAlongAxis = ax === "y" ? info.offset.y : info.offset.x
    // Pointer position along axis = original slot center + cumulative drag.
    // Frozen draggedStartRect keeps this stable across mid-drag reorders
    // (the value's own bcrSnapshot entry updates as it changes slots, but
    // we don't use it for the pointer-tracking math here).
    const draggedCenter = centerOf(draggedStartRect, ax) + offsetAlongAxis

    // Center-cross loop — handles fast drags crossing multiple siblings
    // in one frame. Each successful swap mutates values, re-snapshots, and
    // checks the new neighbor.
    let didSwap = true
    while (didSwap) {
      didSwap = false
      const currentArray = values()
      const draggedIndex = currentArray.indexOf(value)
      if (draggedIndex < 0) return // dragged item externally removed mid-iter

      // Direction = where the pointer is relative to the dragged item's
      // CURRENT slot. Read from the live snapshot (which reflects each
      // post-swap layout position).
      const currentSlotRect = bcrSnapshot.get(value)
      if (currentSlotRect === undefined) return
      const currentSlotCenter = centerOf(currentSlotRect, ax)
      const direction = draggedCenter > currentSlotCenter ? 1 : -1

      const neighborIndex = draggedIndex + direction
      if (neighborIndex < 0 || neighborIndex >= currentArray.length) break

      const neighborValue = currentArray[neighborIndex] as T
      const neighborRect = bcrSnapshot.get(neighborValue)
      if (neighborRect === undefined) break
      const neighborCenter = centerOf(neighborRect, ax)

      const crossed =
        direction > 0
          ? draggedCenter > neighborCenter
          : draggedCenter < neighborCenter

      if (crossed) {
        const swapped = currentArray.slice()
        swapped[draggedIndex] = neighborValue
        swapped[neighborIndex] = value
        internalSetValues(swapped)
        // <For> reconciles synchronously; the DOM is reordered before this
        // line. Re-read fresh bcrs for the post-swap layout — the dragged
        // value's new entry reflects its new slot (used for direction
        // detection above), but draggedStartRect stays frozen.
        snapshotAll()
        didSwap = true
      }
    }
  }

  function handleDragEnd(value: T): void {
    if (activeValue !== value) return
    activeValue = null
    activeAxis = null
    activeElement = null
    activePointerId = null
    draggedStartRect = null
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
