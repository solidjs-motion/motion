import { createContext, createMemo, type JSX, useContext } from "solid-js"
import type { MotionConfigContextValue, MotionConfigProps } from "./types"

/**
 * Default context — no reduced motion override, no inherited transition, no
 * CSP nonce. Descendants without a `<MotionConfig>` ancestor get this.
 */
const defaultMotionConfig: MotionConfigContextValue = {
  reducedMotion: () => "never",
  transition: () => undefined,
  nonce: () => undefined,
}

export const MotionConfigContext = createContext<MotionConfigContextValue>(defaultMotionConfig)

export function useMotionConfig(): MotionConfigContextValue {
  return useContext(MotionConfigContext)
}

/**
 * Provider that flows reduced-motion mode, default transition, and CSP nonce
 * to every descendant motion element.
 *
 * @example
 * <MotionConfig reducedMotion="user" transition={{ duration: 0.4 }}>
 *   <App />
 * </MotionConfig>
 */
export function MotionConfig(props: MotionConfigProps): JSX.Element {
  const value: MotionConfigContextValue = {
    reducedMotion: createMemo(() => props.reducedMotion ?? "never"),
    transition: createMemo(() => props.transition),
    nonce: createMemo(() => props.nonce),
  }
  return <MotionConfigContext.Provider value={value}>{props.children}</MotionConfigContext.Provider>
}
