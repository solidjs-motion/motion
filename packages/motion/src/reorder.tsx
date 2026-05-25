// ---------------------------------------------------------------------------
// <Reorder.Group> / <Reorder.Item> — JSX wrappers around createReorder.
// ADR 0008, Plan §3.2 + §4.4.
//
// The components are intentionally thin — Group calls createReorder and
// publishes the result via context; Item reads the context and renders a
// Dynamic spread with the primitive's `item()` callable. The primitive
// does all the work; the components are the ergonomic surface most users
// will reach for.
//
// Two design choices worth noting (and documented in the JSDoc below):
//
//   - Group wraps its children in `<LayoutGroup>` so layoutId scoping
//     stays per-list. Same convention as the layout-animations plan.
//
//   - Item renders the element directly via Dynamic, NOT wrapped in
//     `m.Provider`. The motion-proxy pattern (m.Provider around the
//     Dynamic) needs the outer-projection-context capture trick to
//     avoid measuring against self — a fix that requires threading an
//     internal config into useMotion. createReorder.item doesn't
//     expose that channel in v1, so Item skips m.Provider entirely.
//     The trade-off: variant context (hover/press labels) does NOT
//     propagate from a `<Reorder.Item>` into its children. Users who
//     need that should compose `<Reorder.Item>` with a nested
//     `<motion.div>` for the variant root.
// ---------------------------------------------------------------------------

import {
  type Accessor,
  createContext,
  type JSX,
  splitProps,
  useContext,
} from "solid-js"
import { Dynamic } from "solid-js/web"

import { LayoutGroup } from "./layout-group"
import { MOTION_OPT_KEYS } from "./motion-proxy"
import { createReorder, type ReorderResult } from "./primitives/createReorder"
import type { ElementProps, MotionOptions } from "./types"

/**
 * Props for {@link Reorder.Group}. The container element defaults to `<ul>`
 * and is `as`-overridable. Any additional JSX attributes (`class`, `id`,
 * `style`, event handlers, `data-*`, …) pass through to the rendered
 * element.
 */
export type ReorderGroupProps<T> = Omit<
  JSX.HTMLAttributes<HTMLElement>,
  "children"
> & {
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
  return (
    <ReorderGroupContext.Provider value={reorder as AnyReorderResult}>
      <LayoutGroup>
        <Dynamic
          component={own.as ?? "ul"}
          ref={reorder.group.ref}
          {...(rest as JSX.HTMLAttributes<HTMLElement>)}
        >
          {own.children}
        </Dynamic>
      </LayoutGroup>
    </ReorderGroupContext.Provider>
  )
}

function Item<T>(props: ReorderItemProps<T>): JSX.Element {
  const reorder = useReorderGroupContext<T>()
  const [own, motionAndDom] = splitProps(props, ["value", "as", "children"])
  // Same split-by-MOTION_OPT_KEYS pattern as the motion proxy. After this,
  // `motionOpts` is the MotionOptions subset feeding createReorder.item,
  // and `domProps` is everything else (class/id/style/event handlers/data-*)
  // which gets merged into the rendered element via `m(domProps)`.
  const [motionOpts, domProps] = splitProps(motionAndDom, MOTION_OPT_KEYS)
  const m = reorder.item(own.value, () => motionOpts as MotionOptions)
  return (
    <Dynamic component={own.as ?? "li"} {...m(domProps as ElementProps)}>
      {own.children}
    </Dynamic>
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
 */
export const Reorder: {
  Group: <T>(props: ReorderGroupProps<T>) => JSX.Element
  Item: <T>(props: ReorderItemProps<T>) => JSX.Element
} = {
  Group: Group as <T>(props: ReorderGroupProps<T>) => JSX.Element,
  Item: Item as <T>(props: ReorderItemProps<T>) => JSX.Element,
}
