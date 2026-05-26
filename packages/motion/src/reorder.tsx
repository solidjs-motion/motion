// ---------------------------------------------------------------------------
// <Reorder.Group> / <Reorder.Item> — JSX wrappers around createReorder.
// ADR 0008, Plan §3.2 + §4.4.
//
// The components are intentionally thin — Group calls createReorder and
// publishes the result via context; Item reads the context, captures the
// outer projection context, and renders a Dynamic wrapped in m.Provider
// so variant labels propagate from a Reorder.Item to nested motion
// children (matches the motion-proxy's makeMotionTag pattern).
//
//   - Group wraps its children in `<LayoutGroup>` so layoutId scoping
//     stays per-list. Same convention as the layout-animations plan.
//
//   - Item captures `useProjectionContext()` BEFORE m.Provider wraps
//     the Dynamic, then threads it through createReorder.item's
//     internal config so createMotion's ref-fire reads the OUTER
//     projection context (not the element's own push). Without this
//     capture, ref-fire would measure against self → no FLIP.
// ---------------------------------------------------------------------------

import { type Accessor, createContext, type JSX, splitProps, useContext } from "solid-js"
import { Dynamic } from "solid-js/web"

import { LayoutGroup } from "./layout-group"
import { MOTION_OPT_KEYS } from "./motion-proxy"
import { createReorder, type ReorderResult } from "./primitives/createReorder"
import { useProjectionContext } from "./projection-context"
import type { ElementProps, MotionOptions, ProjectionContextValue, UseMotionResult } from "./types"
import { useMotion } from "./use-motion"

/**
 * Internal-only signature used by Reorder.Item to pass the captured
 * outer projection context through to createReorder.item. The public
 * `ReorderResult<T>["item"]` type omits this third parameter so
 * primitive consumers don't see it (TypeScript will reject any call
 * that passes a third arg via the public type). Inside this file we
 * cast to recover the third-arg signature at the one call site that
 * needs it.
 */
type ReorderItemWithConfig<T> = (
  value: T,
  motionOptions?: MotionOptions | Accessor<MotionOptions>,
  config?: { parentProjectionContext?: ProjectionContextValue },
) => UseMotionResult

/**
 * Props for {@link Reorder.Group}. The container element defaults to `<ul>`
 * and is `as`-overridable. Any additional JSX attributes (`class`, `id`,
 * `style`, event handlers, `data-*`, …) pass through to the rendered
 * element.
 */
export type ReorderGroupProps<T> = Omit<JSX.HTMLAttributes<HTMLElement>, "children"> & {
  /**
   * The current list. Accepts either an `Accessor<T[]>` (`createSignal`)
   * or a `T[]` directly (`createStore` — `store.items` is a reactive
   * proxy that isn't itself a function). Both forms track reactivity.
   */
  values: Accessor<T[]> | T[]
  /**
   * Setter for the values array. Any function with shape
   * `(next: T[]) => void`. Solid's `Setter<T[]>` from `createSignal`
   * AND `createStore`'s `SetStoreFunction<T[]>` are both accepted via
   * structural compatibility. `NoInfer` ensures T is inferred from
   * `values` alone — without it, SetStoreFunction's overloaded shape
   * could confuse inference and resolve T to `number` (the array-index
   * type) instead of the item type.
   */
  onReorder: (next: NoInfer<T>[]) => void
  /** Drag + center-cross axis. Default: `"y"`. */
  axis?: "x" | "y"
  /**
   * Cancel the in-progress drag when `values` is mutated from outside
   * the primitive. See `ReorderOptions.cancelOnExternalReorder`. Default: `false`.
   */
  cancelOnExternalReorder?: boolean
  /** Container element tag. Default: `"ul"`. */
  as?: keyof JSX.IntrinsicElements
  children: JSX.Element
}

/**
 * Props for {@link Reorder.Item}. Extends `MotionOptions` so per-item
 * animation / variants / drag-handle composition (`dragListener` /
 * `dragControls`) work the same way they do on `<motion.li>`. Any
 * remaining JSX attributes (`class`, `id`, `style`, event handlers, …)
 * pass through to the rendered element.
 *
 * Reorder-controlled fields (`layout`, `drag`, `dragSnapToOrigin`,
 * `dragMomentum`, plus the composed `onDragStart` / `onDrag` /
 * `onDragEnd`) silently override any caller-supplied values — see
 * `ReorderResult.item` for the full list.
 */
export type ReorderItemProps<T> = MotionOptions &
  Omit<JSX.HTMLAttributes<HTMLElement>, "children"> & {
    /** Identity for this item. Must be a value from the group's `values`
     * array (or its reactive form); reference identity is what `<For>`
     * uses for row reconciliation. */
    value: T
    /** Item element tag. Default: `"li"`. */
    as?: keyof JSX.IntrinsicElements
    children: JSX.Element
  }

// The provider stores the generic-erased `ReorderResult<unknown>`. The
// consumer hook re-narrows via the value type its caller is parameterised
// by. Same pattern Solid uses for its own generic contexts.
type AnyReorderResult = ReorderResult<unknown>
const ReorderGroupContext = createContext<AnyReorderResult | undefined>(undefined)

function useReorderGroupContext<T>(): ReorderResult<T> {
  const ctx = useContext(ReorderGroupContext)
  if (ctx === undefined) {
    throw new Error("<Reorder.Item> must be a descendant of <Reorder.Group>")
  }
  return ctx as ReorderResult<T>
}

function Group<T>(props: ReorderGroupProps<T>): JSX.Element {
  const [own, rest] = splitProps(props, [
    "values",
    "onReorder",
    "axis",
    "cancelOnExternalReorder",
    "as",
    "children",
  ])
  const reorder = createReorder(own.values, own.onReorder, () => ({
    axis: own.axis,
    cancelOnExternalReorder: own.cancelOnExternalReorder,
  }))
  // Mark the group container as a scroll ancestor for descendant FLIPs.
  // Reorder.Items have `layout: true`; when the group is the scrollable
  // viewport for a long list (`max-height` + `overflow: auto`), their
  // projection chain must include this element so post-swap deltas
  // compensate for the group's scroll offset. Without it, sibling FLIPs
  // computed in viewport coordinates would mis-translate when the group
  // is scrolled. Mirrors motion-react's `<Reorder.Group>` (always a
  // motion element with `layoutScroll`). The `m.Provider` wrap below
  // publishes the extended `scrollAncestors` chain to descendants.
  const m = useMotion(() => ({ layoutScroll: true }))
  return (
    <ReorderGroupContext.Provider value={reorder as AnyReorderResult}>
      <LayoutGroup>
        <m.Provider>
          <Dynamic
            component={own.as ?? "ul"}
            {...m({
              ...(rest as ElementProps),
              ref: (el) => {
                if (el instanceof HTMLElement) reorder.group.ref(el)
              },
            })}
          >
            {own.children}
          </Dynamic>
        </m.Provider>
      </LayoutGroup>
    </ReorderGroupContext.Provider>
  )
}

function Item<T>(props: ReorderItemProps<T>): JSX.Element {
  const reorder = useReorderGroupContext<T>()
  // Capture the OUTER projection context BEFORE the Dynamic ends up
  // inside m.Provider. createMotion's ref-fire walks the Solid owner
  // chain via `useProjectionContext()` and — if it found the element's
  // own pushed-projection ctx (provided implicitly inside m.Provider's
  // scope) — would compute `E - P = 0` and skip the FLIP. Threading
  // this OUTER ctx into createReorder.item's internal config passes
  // it down to useMotion, which uses it instead of the live ctx at
  // ref-fire. Same pattern as the motion-proxy's makeMotionTag.
  const outerProjectionCtx = useProjectionContext()
  const [own, motionAndDom] = splitProps(props, ["value", "as", "children"])
  // Same split-by-MOTION_OPT_KEYS pattern as the motion proxy. After this,
  // `motionOpts` is the MotionOptions subset feeding createReorder.item,
  // and `domProps` is everything else (class/id/style/event handlers/data-*)
  // which gets merged into the rendered element via `m(domProps)`.
  const [motionOpts, domProps] = splitProps(motionAndDom, MOTION_OPT_KEYS)
  // Cast to the internal-with-config signature to pass the captured
  // projection context. The public `reorder.item` type doesn't expose
  // the third param — see ReorderItemInternalConfig in createReorder.ts.
  const itemWithConfig = reorder.item as unknown as ReorderItemWithConfig<T>
  const m = itemWithConfig(own.value, () => motionOpts as MotionOptions, {
    parentProjectionContext: outerProjectionCtx,
  })
  return (
    <m.Provider>
      <Dynamic component={own.as ?? "li"} {...m(domProps as ElementProps)}>
        {own.children}
      </Dynamic>
    </m.Provider>
  )
}

/**
 * Compound component for drag-driven list reorder.
 *
 * `<Reorder.Group>` owns the controlled list state and per-list axis;
 * `<Reorder.Item>` wires per-item drag + layout via the group's primitive.
 * Each Item element ends up `layout: true` + `drag: <axis>` with
 * `dragSnapToOrigin: true` and `dragMomentum: false` — reorder-required
 * fields the user cannot override at this layer.
 *
 * @example Basic
 * ```tsx
 * function Sortable() {
 *   const [items, setItems] = createSignal(["a", "b", "c"])
 *   return (
 *     <Reorder.Group values={items} onReorder={setItems}>
 *       <For each={items()}>
 *         {(item) => <Reorder.Item value={item}>{item}</Reorder.Item>}
 *       </For>
 *     </Reorder.Group>
 *   )
 * }
 * ```
 *
 * @example Horizontal with custom container/item tags
 * ```tsx
 * <Reorder.Group axis="x" as="ol" values={items} onReorder={setItems}>
 *   <For each={items()}>
 *     {(item) => (
 *       <Reorder.Item as="div" value={item} class="tag">
 *         {item.label}
 *       </Reorder.Item>
 *     )}
 *   </For>
 * </Reorder.Group>
 * ```
 *
 * @example Drag handle (per-item)
 * ```tsx
 * <Reorder.Group values={items} onReorder={setItems}>
 *   <For each={items()}>
 *     {(item) => {
 *       const controls = createDragControls()
 *       return (
 *         <Reorder.Item value={item} dragListener={false} dragControls={controls}>
 *           <button onPointerDown={(e) => controls.start(e)}>⋮</button>
 *           {item.label}
 *         </Reorder.Item>
 *       )
 *     }}
 *   </For>
 * </Reorder.Group>
 * ```
 *
 * @example Exit animation with `<Presence>`
 * Always pair Reorder with `<Presence exitMethod="keep-index">` when items
 * have `exit` declared. The default `exitMethod` ("move-to-end") shuffles
 * the exiting node to the end of the list during its exit window, which
 * fires the layout-coordinator's parent-MO mid-fade and visibly slides
 * the item to the bottom instead of letting it fade in place. `keep-index`
 * holds the slot until exit completes, then survivors FLIP up cleanly.
 * ```tsx
 * <Reorder.Group values={items} onReorder={setItems}>
 *   <Presence exitMethod="keep-index">
 *     <For each={items()}>
 *       {(item) => (
 *         <Reorder.Item
 *           value={item}
 *           initial={{ opacity: 0 }}
 *           animate={{ opacity: 1 }}
 *           exit={{ opacity: 0 }}
 *         >
 *           {item.label}
 *         </Reorder.Item>
 *       )}
 *     </For>
 *   </Presence>
 * </Reorder.Group>
 * ```
 */
export const Reorder: {
  Group: <T>(props: ReorderGroupProps<T>) => JSX.Element
  Item: <T>(props: ReorderItemProps<T>) => JSX.Element
} = {
  Group: Group as <T>(props: ReorderGroupProps<T>) => JSX.Element,
  Item: Item as <T>(props: ReorderItemProps<T>) => JSX.Element,
}
