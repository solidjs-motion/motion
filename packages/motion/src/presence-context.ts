import { createContext, useContext } from "solid-js"
import type { PresenceContextValue } from "./types"

/**
 * No-op context value installed by default. `useMotion` consumers wire their
 * exit-targets through this context, but without an enclosing `<Presence>`
 * ancestor the registration is silently dropped. Phase 3's `<Presence>` swaps
 * in the real implementation that buffers unmounts and awaits exit animations.
 */
const noopPresenceContext: PresenceContextValue = {
  register: () => {},
  unregister: () => {},
  beforeUnmount: () => Promise.resolve(),
}

export const PresenceContext = createContext<PresenceContextValue>(noopPresenceContext)

export function usePresenceContext(): PresenceContextValue {
  return useContext(PresenceContext)
}
