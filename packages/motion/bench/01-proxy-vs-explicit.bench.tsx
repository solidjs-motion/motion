import { bench, describe, vi } from "vitest"
import { render } from "./_render"

// Mock animate so we measure proxy + Solid cost, not WAA.
vi.mock("motion", async () => {
  const actual = await vi.importActual<typeof import("motion")>("motion")
  return {
    ...actual,
    animate: vi.fn(() => ({
      stop: () => {},
      pause: () => {},
      play: () => {},
      cancel: () => {},
      complete: () => {},
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable — mocks motion's animate() controls so we can `await` them in bench without paying the WAA cost.
      then: (resolve: () => void) => {
        resolve()
        return Promise.resolve()
      },
    })),
  }
})

// matchMedia polyfill (reduced-motion query).
const installMatchMedia = () => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const { motion } = await import("../src/motion-proxy")
const { useMotion } = await import("../src/use-motion")

// What this measures
// ------------------
// The cost of the `motion.X` Proxy form vs. equivalent useMotion +
// explicit JSX. Three axes:
//
//   1. Proxy get-trap (cached): how cheap is `motion.div` itself?
//      The cache returns the same Component reference for every access,
//      so the get trap is effectively a Map lookup + return.
//
//   2. Full motion.div mount: spreads MOTION_OPT_KEYS, sets up
//      useMotion, wires the auto-Provider, renders via <Dynamic>.
//      This is the "real cost" of `<motion.div animate={...}>`.
//
//   3. Equivalent useMotion + explicit <div {...m({...})}>: same
//      behavior, hand-written. Tells us the per-element overhead of
//      the proxy abstraction.

describe("motion proxy — get trap (cached factory)", () => {
  bench("motion.div property access (cache hit)", () => {
    // Property access on the Proxy. Returns the cached tag-component.
    const _ = motion.div
    void _
  })

  bench("motion.span property access (cache hit)", () => {
    const _ = motion.span
    void _
  })
})

describe("motion.div vs useMotion — full mount + unmount cycle", () => {
  installMatchMedia()

  bench("<motion.div animate={{ x: 100 }} /> mount", () => {
    const { unmount } = render(() => (
      <motion.div animate={{ x: 100 }} transition={{ duration: 0.3 }}>
        bench
      </motion.div>
    ))
    unmount()
  })

  bench("<div {...useMotion({ animate: { x: 100 } })()} /> mount", () => {
    const { unmount } = render(() => {
      const m = useMotion({ animate: { x: 100 }, transition: { duration: 0.3 } })
      return <div {...m()}>bench</div>
    })
    unmount()
  })
})
