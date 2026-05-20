import { createSignal, Show } from "solid-js"
import { bench, describe, vi } from "vitest"
import { render } from "./_render"

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
      // Synchronous-resolve thenable keeps exit's await microtask-bounded.
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable — see comment above.
      then: (resolve: () => void) => {
        resolve()
        return Promise.resolve()
      },
    })),
  }
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
const { Presence } = await import("../src/presence")

// What this measures
// ------------------
// Full Presence enter + exit roundtrip:
//
//   1. Initial mount: PresenceCore constructs, deferred path-decision
//      memo runs, createSwitchTransition wires up, child's createMotion
//      runs, ref fires, beforeMount called, runEnter fires.
//   2. Exit: setOpen(false) flips the Show, transition-group's onExit
//      calls beforeUnmount, runExit dispatches the exit animate,
//      animate's thenable resolves synchronously (mocked), done() fires,
//      subtree-walk prunes the registry.
//
// Each bench iteration is a render → unmount cycle of the whole tree,
// so the cost includes: Presence setup, motion-child mount with
// enter-ready gate, ref + applyStaticStyle, exit dispatch chain, and
// teardown. With the mocked animate the WAA-driven duration drops out;
// we're measuring the JS coordination cost only.

describe("Presence roundtrip — switch path mount + exit + unmount", () => {
  installMatchMedia()

  bench("<Presence><Show when>{motion.div w/ exit}</Show></Presence>", async () => {
    const [open, setOpen] = createSignal(true)
    const { unmount } = render(() => (
      <Presence>
        <Show when={open()}>
          {(_v) => {
            const m = useMotion({
              initial: { opacity: 0 },
              animate: { opacity: 1 },
              exit: { opacity: 0 },
            })
            return <div {...m()} />
          }}
        </Show>
      </Presence>
    ))
    setOpen(false)
    // Flush microtasks so the exit's thenable resolves and Presence's
    // done() callback fires before the bench iteration ends.
    for (let i = 0; i < 6; i++) await Promise.resolve()
    unmount()
  })
})
