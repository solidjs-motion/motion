import { type Context, createContext, useContext } from "solid-js"
import type { ProjectionContextValue } from "./types"

/**
 * Implicit-root default. Layout-active descendants of a JSX tree with no
 * enclosing `<motion.X layout>`, `<motion.X layoutRoot>`, or
 * `<motion.X layoutScroll>` measure against `document.documentElement`
 * — chosen so top-level layout elements get scroll-stable
 * document-relative coordinates without a separate scroll-compensation
 * pass at the root. The scroll-ancestors chain starts empty; only
 * `layoutScroll` ancestors between the consumer and its projection
 * parent contribute compensation (chain RESETS at each new projection
 * parent — see ADR 0007).
 *
 * SSR safety: `parentEl` is a closure — safe to evaluate at module
 * load. Its body only runs when invoked, and invocations happen only
 * from browser-only measurement closures. No defensive `typeof document`
 * guard (matches the structural pattern used elsewhere in the layout
 * machinery; see plan risk #6).
 */
const defaultProjectionContext: ProjectionContextValue = {
  parentEl: () => document.documentElement,
  scrollAncestors: () => [],
}

export const ProjectionContext: Context<ProjectionContextValue> =
  createContext<ProjectionContextValue>(defaultProjectionContext)

export function useProjectionContext(): ProjectionContextValue {
  return useContext(ProjectionContext)
}
