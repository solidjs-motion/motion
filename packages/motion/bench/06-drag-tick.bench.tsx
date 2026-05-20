import { bench, describe, vi } from "vitest"
import { render } from "./_render"

// Raw pointer-event dispatcher. We can't pull in `@testing-library/dom`
// directly (not a direct dep) and `@solidjs/testing-library`'s pre-compiled
// JS breaks bench mode (see `_render.ts`), so we emit PointerEvents
// ourselves. jsdom's PointerEvent is bare-bones — it doesn't honor most
// `PointerEventInit` fields out of the box — so we shim the few props pan
// /drag actually reads (`pointerId`, `isPrimary`, `clientX`, `clientY`).
type PointerInit = { pointerId: number; isPrimary?: boolean; clientX: number; clientY: number }
function dispatchPointer(target: EventTarget, type: string, init: PointerInit): void {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & PointerInit
  Object.assign(ev, {
    pointerId: init.pointerId,
    isPrimary: init.isPrimary ?? true,
    clientX: init.clientX,
    clientY: init.clientY,
    pointerType: "mouse",
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
  })
  target.dispatchEvent(ev)
}

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
// One drag-tick: a single pointermove event during an active drag
// session. The cost chain inside createPan + createDrag is:
//
//   pointermove event fires
//     → buildInfo (point / delta / offset / velocity)
//     → writeInfo (8 MV.set calls on pan's MVs)
//     → onPan callback fired
//     → drag's handler:
//         · applyElastic if past constraints
//         · clamp to bounds
//         · ve.getValue("x") / ("y").set(...) — writes to the
//           visual element's transform-driving MotionValues
//
// At 60fps we have ~16ms per frame; the drag tick budget should be
// well under that to leave headroom for paint/composite + other work.
// jsdom isn't a perfect proxy for real-browser perf here (no compositor),
// but the numbers tell us the JS cost.

describe("drag tick — single pointermove during active drag", () => {
  installMatchMedia()

  let element!: HTMLElement
  let pointerId = 0
  let lastX = 200

  bench(
    "pointermove tick (x-axis drag, mid-session)",
    () => {
      pointerId++
      lastX += 5
      dispatchPointer(window, "pointermove", { pointerId, clientX: lastX, clientY: 100 })
    },
    {
      setup: () => {
        const { container } = render(() => {
          const m = useMotion({
            drag: "x",
            dragConstraints: { left: -200, right: 200 },
            dragElastic: 0.3,
          })
          return <div {...m()} data-testid="drag-bench" />
        })
        element = container.querySelector("[data-testid='drag-bench']") as HTMLElement
        // Open a drag session so subsequent pointermoves dispatch the
        // full pan + drag write loop (otherwise pointerdown's
        // pre-threshold gate would no-op the moves).
        pointerId = 1
        dispatchPointer(element, "pointerdown", { pointerId, clientX: 100, clientY: 100 })
        // Cross the threshold so onPanStart fires and drag claims x/y.
        dispatchPointer(window, "pointermove", { pointerId, clientX: 150, clientY: 100 })
        lastX = 150
      },
      teardown: () => {
        // Release the drag session so the next bench doesn't see the
        // stale captured pointer.
        dispatchPointer(window, "pointerup", { pointerId, clientX: lastX, clientY: 100 })
      },
    },
  )
})
