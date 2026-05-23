import { type Context, createContext, useContext } from "solid-js"
import { rootLayoutCoordinator } from "./layout-coordinator"
import type { LayoutGroupContextValue } from "./types"

/**
 * Implicit-root default. When no enclosing `<LayoutGroup>` is present,
 * descendants see:
 *
 * - `coordinator`: the module-level `rootLayoutCoordinator` singleton —
 *   `layoutId` elements without a group match against the root.
 * - `broadcast`: `() => 0` — a constant accessor. Subscribing
 *   `createEffect(() => { broadcast(); ... })` runs once (baseline)
 *   and never re-fires from this source. Other triggers (RO, parent
 *   MO, `layoutDependency`) continue to work independently.
 *
 * See Plan §3.3 and Q15 of the design grill for the locked shape.
 */
const defaultLayoutGroupContext: LayoutGroupContextValue = {
  coordinator: rootLayoutCoordinator,
  broadcast: () => 0,
}

export const LayoutGroupContext: Context<LayoutGroupContextValue> =
  createContext<LayoutGroupContextValue>(defaultLayoutGroupContext)

export function useLayoutGroupContext(): LayoutGroupContextValue {
  return useContext(LayoutGroupContext)
}
