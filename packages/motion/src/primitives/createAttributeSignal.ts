import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js"

/**
 * Solid-bridge helper for cases where the source of an ancestor change
 * isn't a Solid signal — third-party DOM manipulation, native HTML
 * attributes like `<dialog open>`, popover state, etc. Returns an
 * `Accessor<number>` that increments whenever any of the watched
 * attributes mutate on the referenced element. Compose with
 * `MotionOptions.layoutDependency` (per-element) or
 * `LayoutGroupProps.dependency` (group-wide) to bridge non-Solid
 * sources into the layout-trigger model.
 *
 * @param ref Either a static `Element` (captured once) or an
 *   `Accessor<Element | null | undefined>` for refs that swap over
 *   time. Same shape as `createInView` for consistency.
 * @param attrs Names of attributes to watch. Defaults to
 *   `["class", "style"]` — the two attributes most commonly mutated
 *   by third-party DOM libs and native HTML state changes. Empty
 *   array is a valid no-op (no observer is created; the signal stays
 *   at `0`). To react to specific attributes independently, create
 *   one signal per attribute (e.g. `createAttributeSignal(el, ["class"])`
 *   and `createAttributeSignal(el, ["style"])`) — the signal is
 *   intentionally a trigger, not a payload, so per-attribute
 *   selectivity belongs in the watch list, not in the signal value.
 *
 * @returns A monotonically-increasing counter (`Accessor<number>`).
 *   Consumers subscribe via `signal()` and don't care about the
 *   value — only that it changed. Wraps at `Number.MAX_SAFE_INTEGER`
 *   (effectively never).
 *
 * @example Reactive ref via createSignal
 * ```tsx
 * const [el, setEl] = createSignal<HTMLElement>()
 * const tick = createAttributeSignal(el, ["class"])
 * useMotion(() => ({ layout: true, layoutDependency: tick }))
 * <div ref={setEl}>watch my class</div>
 * ```
 *
 * @example Static ref captured imperatively
 * ```tsx
 * let dialogEl!: HTMLDialogElement
 * const tick = createAttributeSignal(dialogEl, ["open"])
 * <dialog ref={dialogEl}>...</dialog>
 * ```
 *
 * @example Bridging into a LayoutGroup dependency
 * ```tsx
 * const [el, setEl] = createSignal<HTMLElement>()
 * const tick = createAttributeSignal(el, ["class", "data-state"])
 * <ThirdPartyAccordion ref={setEl}>
 *   <LayoutGroup dependency={tick}>
 *     <For each={items()}>{(item) => <motion.div layout>{item}</motion.div>}</For>
 *   </LayoutGroup>
 * </ThirdPartyAccordion>
 * ```
 *
 * **SSR safety:** the `MutationObserver` setup runs inside
 * `createEffect`, which doesn't fire server-side. Returns `0`
 * server-side (the signal's initial value). No `typeof
 * MutationObserver` guard — same structural-safety pattern as the
 * rest of the layout machinery.
 */
export function createAttributeSignal(
  ref: Accessor<Element | null | undefined> | Element | null | undefined,
  attrs: string[] = ["class", "style"],
): Accessor<number> {
  const [tick, setTick] = createSignal(0)

  // Normalize ref to function form. Mirrors `createInView`.
  const getRef: Accessor<Element | null | undefined> =
    typeof ref === "function" ? (ref as Accessor<Element | null | undefined>) : () => ref

  createEffect(() => {
    const el = getRef()
    if (!el) return
    if (attrs.length === 0) return

    const observer = new MutationObserver(() => {
      // Increment the counter. We don't care which attribute changed
      // or what it changed to — consumers subscribe to the counter and
      // re-react. Wraps at MAX_SAFE_INTEGER (effectively never in
      // realistic session lifetimes).
      setTick((n) => (n + 1) % Number.MAX_SAFE_INTEGER)
    })
    observer.observe(el, { attributes: true, attributeFilter: attrs })

    onCleanup(() => observer.disconnect())
  })

  return tick
}
