import { type Accessor, createComputed, createSignal, onCleanup } from "solid-js"
import type { ViewportOptions } from "../types"

// ---------------------------------------------------------------------------
// createInView — observe an element's intersection with a viewport and expose
// a boolean accessor. Standalone hook, distinct from the `inView` *gesture* on
// MotionOptions (which animates a target when in view).
// ---------------------------------------------------------------------------

/**
 * Observe an element via {@link IntersectionObserver} and expose its in-view
 * state as a Solid {@link Accessor}.
 *
 * Pass a ref-style accessor that returns the element. The observer attaches
 * once the accessor returns a non-null element and re-attaches if it changes.
 * The observer is disconnected on owner disposal.
 *
 * @example
 * const [el, setEl] = createSignal<HTMLElement>()
 * const visible = createInView(el, { once: true })
 *
 * createEffect(() => {
 *   if (visible()) console.log("now in view")
 * })
 *
 * <div ref={setEl}>watch me</div>
 */
export function createInView(
  ref: () => Element | null,
  options?: ViewportOptions,
): Accessor<boolean> {
  const [visible, setVisible] = createSignal<boolean>(false)

  // createComputed runs both first iteration and updates synchronously, so the
  // IntersectionObserver attaches as soon as the ref accessor resolves to an
  // element and re-attaches synchronously on changes. onCleanup is scoped to
  // each iteration — fires on re-run AND on owner disposal.
  createComputed(() => {
    const el = ref()
    if (!el) return

    const threshold = resolveThreshold(options?.amount)
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            if (options?.once) observer.disconnect()
          } else if (!options?.once) {
            setVisible(false)
          }
        }
      },
      {
        root: options?.root?.() ?? null,
        rootMargin: options?.margin ?? "0px",
        threshold,
      },
    )
    observer.observe(el)

    onCleanup(() => observer.disconnect())
  })

  return visible
}

function resolveThreshold(amount: ViewportOptions["amount"]): number | number[] {
  if (typeof amount === "number") return amount
  if (amount === "all") return 1
  // "some" or undefined → minimal threshold (any pixel intersecting)
  return 0
}
