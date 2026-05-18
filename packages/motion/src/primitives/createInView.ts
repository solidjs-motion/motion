import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js"
import type { ViewportOptions } from "../types"

// ---------------------------------------------------------------------------
// createInView — observe an element's intersection with a viewport.
//
// Standalone hook, distinct from the `inView` *gesture* on MotionOptions
// (which animates a target when in view). Returns a pair of Solid Accessors
// for the boolean and the raw IntersectionObserverEntry — booleans and
// objects aren't animate-able, so a MotionValueAccessor would only add weight
// (compare with createPan, where numeric fields ARE MVs because they're
// animate-able and composable).
// ---------------------------------------------------------------------------

export type CreateInViewOptions = ViewportOptions & {
  /**
   * Fires with the raw {@link IntersectionObserverEntry} on every
   * visibility transition (enter AND leave). Convenience hook for callers
   * who prefer event-driven access to the entry — the entry is also
   * available reactively via the returned `view.entry()` accessor.
   */
  onChange?: (entry: IntersectionObserverEntry) => void
}

/** Returned by {@link createInView}. Two Solid Accessors — call them to track. */
export type CreateInViewResult = {
  /** Solid Accessor; `true` while the element intersects the viewport per the configured threshold. */
  isInView: Accessor<boolean>
  /** Solid Accessor; the most recent {@link IntersectionObserverEntry}, or `null` before any. */
  entry: Accessor<IntersectionObserverEntry | null>
}

/**
 * Observe an element via {@link IntersectionObserver} and expose its
 * in-view state as a pair of Solid Accessors.
 *
 * Pass a ref-style accessor that returns the element. The observer
 * attaches once the accessor returns a non-null element and re-attaches
 * if it changes. The observer is disconnected on owner disposal.
 *
 * Options can be a static object or a function form (matching `useMotion`
 * and `createPan`'s convention). The function form is tracked inside the
 * effect — option changes (e.g., switching `root`) re-attach the observer.
 *
 * @example Static options
 * const [el, setEl] = createSignal<HTMLElement>()
 * const view = createInView(el, { once: true })
 * createEffect(() => {
 *   if (view.isInView()) console.log("now in view")
 * })
 *
 * @example Function-form options (reactive)
 * const [root, setRoot] = createSignal<HTMLElement>()
 * const view = createInView(el, () => ({ root, margin: "100px" }))
 *
 * @example Reading the raw entry reactively
 * const view = createInView(el)
 * createEffect(() => {
 *   const e = view.entry()
 *   if (e) console.log("ratio:", e.intersectionRatio)
 * })
 *
 * <div ref={setEl}>watch me</div>
 */
export function createInView(
  ref: () => Element | null | undefined,
  options: CreateInViewOptions | (() => CreateInViewOptions) = {},
): CreateInViewResult {
  const [isInView, setIsInView] = createSignal(false)
  const [entry, setEntry] = createSignal<IntersectionObserverEntry | null>(null)

  // createEffect — Solid-idiomatic for side-effect setup (attaching the
  // IntersectionObserver). First iteration runs in the next microtask,
  // which is harmless: a freshly-mounted element can't be in or out of
  // the viewport before the microtask flushes. Option reads inside the
  // effect's body are tracked — function-form options that read signals
  // will re-run the effect (and re-attach the observer) on change.
  createEffect(() => {
    const el = ref()
    if (!el) return
    const opts = typeof options === "function" ? options() : options

    const threshold = resolveThreshold(opts.amount)
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          // Fire onChange first so callers can synchronously inspect the
          // entry before any downstream signal-effects see the new state.
          opts.onChange?.(e)
          // Update the entry signal either way — consumers reading
          // `view.entry()` reactively see both enter and leave.
          setEntry(e)
          if (e.isIntersecting) {
            setIsInView(true)
            if (opts.once) observer.disconnect()
          } else if (!opts.once) {
            setIsInView(false)
          }
        }
      },
      {
        root: opts.root?.() ?? null,
        rootMargin: opts.margin ?? "0px",
        threshold,
      },
    )
    observer.observe(el)

    onCleanup(() => observer.disconnect())
  })

  return { isInView, entry }
}

function resolveThreshold(amount: ViewportOptions["amount"]): number | number[] {
  // Pass arrays through unchanged so callers can request continuous
  // `intersectionRatio` updates (the underlying IntersectionObserver fires
  // once per threshold crossing, so a fine array → near-live ratio).
  if (Array.isArray(amount)) return amount
  if (typeof amount === "number") return amount
  if (amount === "all") return 1
  // "some" or undefined → minimal threshold (any pixel intersecting)
  return 0
}
