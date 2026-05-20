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
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable — mocks motion's animate() controls so we can `await` them in bench without paying the WAA cost.
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

// What this measures
// ------------------
// `useMotion` mount cost across four canonical option shapes. Each
// bench is a single render + immediate unmount cycle, so we're
// measuring: useMotion construction → motionRef wire-up → createMotion
// invocation (state machine setup, applyStaticStyle, gesture listeners
// attach, drag setup) → Solid disposal.
//
// jsdom is the test environment, so absolute numbers are unreliable
// against real-browser performance. The numbers are useful for
// relative regression detection (this shape ~2x another) and for
// catching unintentional perf drops between commits.

describe("useMotion mount — option-shape comparison", () => {
  installMatchMedia()

  bench("no opts: useMotion({})", () => {
    const { unmount } = render(() => {
      const m = useMotion({})
      return <div {...m()} />
    })
    unmount()
  })

  bench("simple animate target", () => {
    const { unmount } = render(() => {
      const m = useMotion({
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.3 },
      })
      return <div {...m()} />
    })
    unmount()
  })

  bench("variant-driven (with cascade-ready variants map)", () => {
    const { unmount } = render(() => {
      const m = useMotion({
        initial: "closed",
        animate: "open",
        variants: {
          open: { opacity: 1, x: 0 },
          closed: { opacity: 0, x: -16 },
        },
        transition: { duration: 0.3 },
      })
      return <div {...m()} />
    })
    unmount()
  })

  bench("callback-heavy (animation + gesture lifecycle hooks)", () => {
    const { unmount } = render(() => {
      const m = useMotion({
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        hover: { scale: 1.05 },
        press: { scale: 0.95 },
        onAnimationStart: () => {},
        onAnimationComplete: () => {},
        onHoverStart: () => {},
        onHoverEnd: () => {},
        onPressStart: () => {},
        onPress: () => {},
      })
      return <div {...m()} />
    })
    unmount()
  })

  bench("drag-enabled", () => {
    const { unmount } = render(() => {
      const m = useMotion({
        drag: "x",
        dragConstraints: { left: -100, right: 100 },
        dragElastic: 0.3,
      })
      return <div {...m()} />
    })
    unmount()
  })
})
