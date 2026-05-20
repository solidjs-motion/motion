import { bench, describe, vi } from "vitest"
import { render } from "./_render"

const animateSpy = vi.fn(() => ({
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
}))

vi.mock("motion", async () => {
  const actual = await vi.importActual<typeof import("motion")>("motion")
  return { ...actual, animate: animateSpy }
})

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

const { useMotion } = await import("../src/use-motion")
const { createStore } = await import("solid-js/store")
const { createMotion } = await import("../src/primitives/createMotion")

// What this measures
// ------------------
// The state-machine "flip" cycle that every gesture activation triggers:
//
//   setActive("whileHover", true)
//     → store update
//     → `winners` createMemo re-runs (resolves the new priority chain)
//     → diff effect re-runs (compares against lastApplied)
//     → motion's animate() dispatched with the changed keys
//
// We use createMotion directly with an externalActiveStore so we can
// flip flags without synthesizing pointer events. animateSpy lets us
// confirm the dispatch fires but ignores the actual WAA cost.

describe("state machine flip — setActive → winners → animate dispatch", () => {
  installMatchMedia()

  // One shared element per bench — set up in a hidden DOM node so the
  // ref fires and createMotion wires up the state machine.
  let setActiveStore!: ReturnType<typeof createStore<Record<string, boolean>>>[1]

  bench(
    "hover flip → animate dispatched",
    () => {
      // Toggle the whileHover flag. setActive triggers the winners memo,
      // which runs the diff effect, which calls animate().
      setActiveStore({ whileHover: true })
      setActiveStore({ whileHover: false })
    },
    {
      setup: () => {
        const { container } = render(() => {
          const m = useMotion({
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            hover: { scale: 1.05, y: -4 },
          })
          return <div {...m()} data-testid="bench-el" />
        })
        // Re-run with explicit external store so we can access the
        // setActive setter directly. Stripping out useMotion in
        // favor of createMotion would also work; using a fresh
        // setup that thread an externalActiveStore is the cleanest
        // path.
        const store = createStore<Record<string, boolean>>({
          animate: true,
          whileHover: false,
          whilePress: false,
          whileFocus: false,
          whileInView: false,
          whileDrag: false,
          exit: false,
        })
        setActiveStore = store[1]
        const target = container.querySelector("[data-testid='bench-el']") as HTMLElement
        createMotion(
          target,
          () => ({
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            hover: { scale: 1.05, y: -4 },
          }),
          { activeStore: store as never },
        )
      },
    },
  )

  bench(
    "press flip → animate dispatched",
    () => {
      setActiveStore({ whilePress: true })
      setActiveStore({ whilePress: false })
    },
    {
      setup: () => {
        const { container } = render(() => {
          const m = useMotion({
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            press: { scale: 0.95 },
          })
          return <div {...m()} data-testid="bench-el-press" />
        })
        const store = createStore<Record<string, boolean>>({
          animate: true,
          whileHover: false,
          whilePress: false,
          whileFocus: false,
          whileInView: false,
          whileDrag: false,
          exit: false,
        })
        setActiveStore = store[1]
        const target = container.querySelector("[data-testid='bench-el-press']") as HTMLElement
        createMotion(
          target,
          () => ({
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            press: { scale: 0.95 },
          }),
          { activeStore: store as never },
        )
      },
    },
  )
})
