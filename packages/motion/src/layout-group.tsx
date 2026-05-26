import { createComputed, createSignal, type JSX } from "solid-js"
import { createLayoutCoordinator } from "./layout-coordinator"
import { LayoutGroupContext } from "./layout-group-context"
import type { LayoutGroupContextValue, LayoutGroupProps } from "./types"

/**
 * Fragment-only component (no DOM wrapper). Allocates a per-group
 * {@link LayoutCoordinator} for `layoutId` handoff and a broadcast
 * counter that descendant `layout` elements subscribe to for
 * re-measurement when the group's `dependency` accessor changes.
 *
 * Scoping rules (see ADR 0007 and Plan §3.3):
 *
 * - `layoutId` matches are scoped to the nearest enclosing
 *   `<LayoutGroup>`. Nested groups shadow normally via Solid context
 *   — an inner group's coordinator replaces the outer's for elements
 *   inside the inner group.
 * - The broadcast counter fires only for descendants of THIS group.
 *   Outer-group `dependency` changes do NOT propagate to inner-group
 *   descendants — that's the documented isolation. For deep
 *   broadcast, put the dependency on the outermost group or use
 *   per-element `layoutDependency`.
 * - LayoutGroup does NOT anchor projection ancestry — projection
 *   parents are pushed by `<motion.X layout>` / `<motion.X layoutRoot>`
 *   elements via `ProjectionContext`. The two concerns are orthogonal.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = createSignal(false)
 * <LayoutGroup dependency={open}>
 *   <For each={items()}>{(item) => (
 *     <motion.div layout>{item.label}</motion.div>
 *   )}</For>
 * </LayoutGroup>
 * ```
 *
 * @example Cross-element shared transitions
 * ```tsx
 * <LayoutGroup>
 *   <Show when={mode() === "thumb"}>
 *     <motion.div layoutId="card" class="thumbnail" />
 *   </Show>
 *   <Show when={mode() === "hero"}>
 *     <motion.div layoutId="card" class="hero" />
 *   </Show>
 * </LayoutGroup>
 * ```
 */
export function LayoutGroup(props: LayoutGroupProps): JSX.Element {
  const coordinator = createLayoutCoordinator()
  const [broadcast, setBroadcast] = createSignal(0)

  // createComputed: synchronous on first iteration AND on updates.
  // First iteration bumps broadcast 0 → 1 (harmless — descendants
  // establish their First baseline on the first measurement pass and
  // no animation fires from a baseline-only measurement). Subsequent
  // dependency changes bump the counter and descendant
  // `createEffect(() => { broadcast(); scheduleMeasurement() })`
  // subscribers re-fire.
  //
  // Reading `props.dependency?.()` inside subscribes to whatever
  // signal the user's dependency accessor reads. Accessor-only typing
  // (locked Q6) rules out the static-value footgun where a bare
  // value would silently never fire.
  createComputed(() => {
    props.dependency?.()
    setBroadcast((n) => n + 1)
  })

  const ctx: LayoutGroupContextValue = { coordinator, broadcast }

  return <LayoutGroupContext.Provider value={ctx}>{props.children}</LayoutGroupContext.Provider>
}
