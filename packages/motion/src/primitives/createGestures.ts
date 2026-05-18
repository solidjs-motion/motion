import { hover, press } from "motion-dom"
import { onCleanup } from "solid-js"
import type { MotionOptions } from "../types"
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
}
