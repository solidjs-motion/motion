import { createContext, useContext } from "solid-js"
import type { PresenceContextValue } from "./types"

/**
 * No-op default. `useMotion` consumers wire their `exit` targets through this
 * context, but without an enclosing `<Presence>` or `useAnimatePresence()`
 * the registration is silently dropped. The real implementations live in
 * `presence.tsx` (Phase 3).
 *
 * The shape is the inverted one (see types.ts JSDoc): children register a
 * `runExit` callable; Presence dispatches via `beforeUnmount`. The no-op
 * accepts the registration and resolves `beforeUnmount` immediately so
 * motion children outside a `<Presence>` unmount instantly without trying
 * to animate.
 */
const noopPresenceContext: PresenceContextValue = {
  register: () => {},
  unregister: () => {},
  beforeUnmount: () => Promise.resolve(),
  // `registerEnter` / `beforeMount` / `initial` intentionally LEFT UNDEFINED.
  // createMotion detects "in a real Presence" by `presence.initial !== undefined`
  // (the no-op leaves it undefined). Without that signal it animates first-
  // mount immediately — outside a Presence the element is always already in
  // the DOM by the time createMotion runs, so no defer is needed.
}

export const PresenceContext = createContext<PresenceContextValue>(noopPresenceContext)

export function usePresenceContext(): PresenceContextValue {
  return useContext(PresenceContext)
}
