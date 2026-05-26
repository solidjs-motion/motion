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
//
// Uses `IntersectionObserver` directly instead of wrapping motion's `inView()`
// for two reasons:
//
//   1. motion's `inView` silently drops `amount: number[]`. Its threshold
//      mapping is `typeof amount === "number" ? amount : thresholds[amount]`
//      (with `thresholds = { some: 0, all: 1 }`), so an array falls into
//      `thresholds[undefined]` and the observer ends up with no threshold.
//      We need array thresholds for continuous `intersectionRatio` reads
//      (single-threshold observers stay silent between crossings, leaving
//      `entry.intersectionRatio` stale).
//
//   2. motion's `inView` is asymmetric and callback-only: it guards on
//      `isIntersecting === Boolean(onEnd)` and only fires on the
//      enter/leave transition, with `onEnd` lifecycle bound to whether
//      `onStart` returned a function. That contract doesn't reactively
//      surface every threshold crossing, and bridging it to a Solid signal
//      ends up duplicating most of the IntersectionObserver bookkeeping
//      anyway. Going direct is leaner and gives us the full motion-react
//      `ViewportOptions` surface.
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
 * The `ref` argument accepts EITHER a Solid Accessor returning the element
 * OR a static Element. The accessor form re-attaches the observer when the
 * accessor's return value changes; the static form captures the element
 * once — reassignment of the variable does NOT re-attach.
 *
 * Options can be a static object or an accessor (matching `useMotion`,
 * `createMotion`, and `createPan`'s convention). The accessor form is
 * tracked inside the effect; option changes (e.g., switching `root`)
 * re-attach the observer. Per-field accessors on options were dropped in
 * 0.2.0 — wrap the whole options object in an accessor for reactivity.
 *
 * @example Static options
 * const [el, setEl] = createSignal<HTMLElement>()
 * const view = createInView(el, { once: true })
 * createEffect(() => {
 *   if (view.isInView()) console.log("now in view")
 * })
 *
 * @example Accessor-form options (reactive)
 * const [rootEl, setRootEl] = createSignal<HTMLElement>()
 * const view = createInView(el, () => ({ root: rootEl(), margin: "100px" }))
 *
 * @example Static Element ref (captured once)
 * const div = document.querySelector(".target") as HTMLElement
 * const view = createInView(div, { once: true })
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
  ref: Accessor<Element | null | undefined> | Element | null | undefined,
  options: CreateInViewOptions | Accessor<CreateInViewOptions> = {},
): CreateInViewResult {
  const [isInView, setIsInView] = createSignal(false)
  const [entry, setEntry] = createSignal<IntersectionObserverEntry | null>(null)

  // Normalize ref + options to function form. A static Element is captured
  // once via a constant accessor — no re-attach on variable reassignment;
  // pass the accessor form for reactive refs.
  const getRef: Accessor<Element | null | undefined> =
    typeof ref === "function" ? (ref as Accessor<Element | null | undefined>) : () => ref
  const getOpts: Accessor<CreateInViewOptions> =
    typeof options === "function" ? options : () => options

  // createEffect — Solid-idiomatic for side-effect setup (attaching the
  // IntersectionObserver). First iteration runs in the next microtask,
  // which is harmless: a freshly-mounted element can't be in or out of
  // the viewport before the microtask flushes. Option reads inside the
  // effect's body are tracked — function-form options that read signals
  // will re-run the effect (and re-attach the observer) on change.
  createEffect(() => {
    const el = getRef()
    if (!el) return
    const opts = getOpts()

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
        root: opts.root ?? null,
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
