import { type Accessor, from } from "solid-js"

/**
 * A reactive `Accessor<boolean>` tracking the user's
 * `prefers-reduced-motion: reduce` media query.
 *
 * Returns `false` server-side (no `window.matchMedia`). On the client, it seeds
 * with the current match state and updates as the system preference toggles.
 * The matchMedia listener is removed automatically on owner disposal via
 * `from`'s teardown callback.
 *
 * @example
 * const reduced = createReducedMotion()
 * createEffect(() => {
 *   if (reduced()) console.log("user prefers reduced motion")
 * })
 */
export function createReducedMotion(): Accessor<boolean> {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => false
  }
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)")
  // `from` produces an Accessor<T | undefined>; we seed synchronously inside the
  // producer so the cast to Accessor<boolean> is sound.
  return from<boolean>((set) => {
    set(mql.matches)
    const handler = (e: MediaQueryListEvent) => set(e.matches)
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }) as Accessor<boolean>
}

/**
 * Compute the effective reduced-motion state by combining a {@link MotionConfig}
 * `reducedMotion` setting with the system preference.
 *
 * - `"always"` — forced reduced, regardless of system pref
 * - `"never"` — never reduced, regardless of system pref
 * - `"user"` — respect system pref
 *
 * @example
 * const reduced = shouldReduceMotion("user", createReducedMotion()())
 */
export function shouldReduceMotion(
  configValue: "always" | "never" | "user",
  systemReduced: boolean,
): boolean {
  if (configValue === "always") return true
  if (configValue === "never") return false
  return systemReduced
}
