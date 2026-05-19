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
  // `initial` left undefined — consumers read it as "default to true" when
  // no Presence is providing a value.
}

export const PresenceContext = createContext<PresenceContextValue>(noopPresenceContext)

export function usePresenceContext(): PresenceContextValue {
  return useContext(PresenceContext)
}
