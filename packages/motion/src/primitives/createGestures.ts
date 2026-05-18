import { addDomEvent, hover, press } from "motion-dom"
import { createEffect, onCleanup } from "solid-js"
import type { MotionOptions } from "../types"
import { createInView } from "./createInView"
import type { SetActive } from "./gesture-state"

// ---------------------------------------------------------------------------
// createGestures — wires pointer-driven gestures (hover, press, focus, inView)
// to the gesture state machine's `setActive`. Phase 2 Commit 2 wires hover and
// press only; focus and inView land in Commit 3.
//
// Q1/C — hover and press are routed through motion-dom's primitives directly,
// not re-implemented. ADR 0001 documents the dependency.
//
// Q13/a — listeners attach unconditionally on mount and clean up on owner
// disposal. We do NOT re-attach when `opts.hover` / `opts.press` flip between
// defined and undefined: the state machine's per-key winners memo naturally
// produces an empty diff when an active state has no target, so the extra
// DOM listener pair costs nothing in practice.
// ---------------------------------------------------------------------------

/**
 * Bind pointer-event-driven gestures (hover, press) to the motion element.
 * Toggles the state machine's `whileHover` / `whilePress` flags and forwards
 * events to the user's `MotionCallbacks`.
 */
export function createGestures(
  el: HTMLElement,
  getOpts: () => MotionOptions,
  setActive: SetActive,
): void {
  // ---------- Hover ----------
  // motion-dom's hover(): start callback shape is `(element, event) => onEnd?`.
  // We ignore `element` (always equal to `el` since we pass the element rather
  // than a selector). The optional returned function fires on hover-end.
  //
  // Why motion-dom's hover() rather than addEventListener("pointerenter")?
  // Subtle behaviors handled inside motion-dom we'd otherwise re-derive:
  //   - Press-in-progress defers hover-end until pointer-up (mobile UX).
  //   - Secondary pointer events filtered via isPrimaryPointer.
  //   - pointercancel cleanup parallel to pointerup.
  const stopHover = hover(el, (_element, event) => {
    setActive("whileHover", true)
    getOpts().onHoverStart?.(event)
    return (event) => {
      setActive("whileHover", false)
      getOpts().onHoverEnd?.(event)
    }
  })
  onCleanup(stopHover)

  // ---------- Press ----------
  // motion-dom's press(): same callback shape, plus the end callback receives
  // `(event, { success: boolean })`. `success === true` when the pointer was
  // still over the element at pointer-up (completed press); `false` when it
  // moved away or was cancelled.
  //
  // Q13/c — branch on `info.success`:
  //   onPressStart fires at pointerdown (no success info yet — Q13 tightened
  //     the signature to drop the info param).
  //   onPress fires on completed press.
  //   onPressCancel fires on aborted press.
  const stopPress = press(el, (_element, event) => {
    setActive("whilePress", true)
    getOpts().onPressStart?.(event)
    return (event, info) => {
      setActive("whilePress", false)
      if (info.success) {
        getOpts().onPress?.(event, info)
      } else {
        getOpts().onPressCancel?.(event, info)
      }
    }
  })
  onCleanup(stopPress)

  // ---------- Focus (Q12) ----------
  // Activation (`whileFocus` state) is gated by `:focus-visible` — mouse
  // clicks that incidentally focus an element should NOT trigger the visual
  // state, only keyboard navigation does. The native `onFocus`/`onBlur`
  // callbacks fire for every focus event regardless (Q12b — programmatic
  // listeners shouldn't be filtered).
  //
  // The `:focus-visible` selector throws in older browsers — we fall back
  // to always-active, matching motion/react's behavior in that scenario.
  //
  // We use motion-dom's `addDomEvent` (rather than el.addEventListener
  // directly) for consistency with the rest of Phase 2's motion-dom usage,
  // and because it returns a tidy cleanup function we can hand to onCleanup.
  let focusActiveByVisible = false
  const stopFocus = addDomEvent(el, "focus", (event) => {
    let isFocusVisible = false
    try {
      isFocusVisible = el.matches(":focus-visible")
    } catch {
      isFocusVisible = true
    }
    if (isFocusVisible) {
      setActive("whileFocus", true)
      focusActiveByVisible = true
    }
    getOpts().onFocus?.(event as FocusEvent)
  })
  const stopBlur = addDomEvent(el, "blur", (event) => {
    if (focusActiveByVisible) {
      setActive("whileFocus", false)
      focusActiveByVisible = false
    }
    getOpts().onBlur?.(event as FocusEvent)
  })
  onCleanup(stopFocus)
  onCleanup(stopBlur)

  // ---------- inView (Q10/A1) ----------
  // The gesture reuses Phase 1's `createInView` primitive — same observer
  // setup, same options shape. The extension (added in this commit): an
  // optional onChange callback receives the raw IntersectionObserverEntry,
  // letting the gesture fire onViewportEnter/Leave with the entry the user
  // expects in their MotionCallbacks signature.
  //
  // The element is wrapped in `() => el` because createInView takes a ref
  // accessor (allows reactive ref changes); we pass a constant accessor
  // since our `el` is fixed for the gesture's lifetime.
  //
  // A createEffect bridges createInView's Accessor<boolean> output to the
  // state machine's setActive. When `once: true`, createInView disconnects
  // the observer after the first intersection and `visible()` stays true
  // forever — naturally matching motion/react's "fire once and stay" semantic
  // for whileInView (the gesture never deactivates).
  const inView = createInView(
    () => el,
    // Pass options at construction time (untracked). inViewOptions changes
    // mid-life would require re-observing, which is rare enough we don't
    // wire it reactively for v0.1.
    untrackedInViewOptions(getOpts),
    (entry) => {
      if (entry.isIntersecting) {
        getOpts().onViewportEnter?.(entry)
      } else {
        getOpts().onViewportLeave?.(entry)
      }
    },
  )
  createEffect(() => {
    setActive("whileInView", inView())
  })
}

/**
 * Snapshot `inViewOptions` once at gesture-setup time. Captures the user's
 * options without subscribing the surrounding owner to opts changes.
 *
 * The `root` accessor inside ViewportOptions stays reactive via the inner
 * createComputed in createInView — that's how a reactive root element
 * propagates to the IntersectionObserver. We only snapshot the surrounding
 * options object itself.
 */
function untrackedInViewOptions(getOpts: () => MotionOptions) {
  // We can read getOpts() lazily; the call site is already inside an effect
  // scope only when called from createGestures' body (which runs once at
  // mount). The snapshot is sufficient.
  return getOpts().inViewOptions
}
