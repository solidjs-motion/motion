import { fireEvent, render } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { animateSpy } = vi.hoisted(() => ({
  animateSpy: vi.fn((..._args: unknown[]) => ({
    stop: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    cancel: vi.fn(),
    complete: vi.fn(),
    // biome-ignore lint/suspicious/noThenProperty: motion's AnimationPlaybackControls is intentionally thenable
    then: (resolve: () => void) => {
      resolve()
      return Promise.resolve()
    },
  })),
}))

vi.mock("motion", async () => {
  const actual = await vi.importActual<typeof import("motion")>("motion")
  return { ...actual, animate: animateSpy }
})

const { useMotion } = await import("../../src/use-motion")

// IntersectionObserver mock with synthetic-entry dispatch (mirrors
// in-view.test.tsx's pattern).
type CapturedObserver = {
  callback: IntersectionObserverCallback
  el?: Element
}
let captured: CapturedObserver[] = []

function installControllableObserver() {
  class Controllable {
    callback: IntersectionObserverCallback
    root = null
    rootMargin = ""
    thresholds: ReadonlyArray<number> = []
    observe = vi.fn((el: Element) => {
      const top = captured.at(-1)
      if (top) top.el = el
    })
    unobserve = vi.fn()
    disconnect = vi.fn()
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
    constructor(cb: IntersectionObserverCallback) {
      this.callback = cb
      captured.push({ callback: cb })
    }
  }
  ;(
    globalThis as unknown as { IntersectionObserver: typeof IntersectionObserver }
  ).IntersectionObserver = Controllable as unknown as typeof IntersectionObserver
}

function fireIntersection(el: Element, isIntersecting: boolean) {
  const target = captured.find((c) => c.el === el)
  if (!target) throw new Error(`no IntersectionObserver bound to element`)
  const entry = {
    isIntersecting,
    target: el,
    intersectionRatio: isIntersecting ? 1 : 0,
    boundingClientRect: el.getBoundingClientRect(),
    intersectionRect: isIntersecting ? el.getBoundingClientRect() : new DOMRect(),
    rootBounds: null,
    time: performance.now(),
  } as unknown as IntersectionObserverEntry
  target.callback([entry], target as unknown as IntersectionObserver)
}

beforeEach(() => {
  animateSpy.mockClear()
  captured = []
  installControllableObserver()
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
})

afterEach(() => {
  delete (window as Partial<Window>).matchMedia
})

// ---------------------------------------------------------------------------
// Variant inheritance — Q4 + isControllingVariants (motion-dom parity).
//
// In Solid, `useContext` reads at the call site's owner. For an inheriting
// child to see the parent's `myVariantCtx`, the child's `useMotion` MUST
// run INSIDE the parent's `Provider` — i.e., the child must be a NESTED
// COMPONENT, not inline-spread JSX at the same level.
//
// Each test follows this pattern:
//
//   render(() => {
//     const parent = useMotion({...})
//     return (
//       <div {...parent()}>
//         <parent.Provider>
//           <Child />       {/* nested component, useMotion inside */}
//         </parent.Provider>
//       </div>
//     )
//   })
//
// To isolate the CHILD's animate calls from the parent's (the test mock
// captures both), tests filter by a key the parent doesn't animate.
// ---------------------------------------------------------------------------

describe("variant inheritance — hover propagates from parent to child", () => {
  it("non-controlling child inherits parent's hover label and animates", () => {
    // Child has NO variant-label props (only `variants`) — NOT controlling.
    // Should inherit from parent context.
    function Child() {
      const m = useMotion({
        // No own animate — only the variants map. Inheritance kicks in.
        variants: { rest: { opacity: 1 }, big: { opacity: 0.5 } },
      })
      return <div {...m()} data-testid="child" />
    }
    const { getByTestId, unmount } = render(() => {
      const parent = useMotion({
        animate: "rest",
        hover: "big",
        variants: { rest: { scale: 1 }, big: { scale: 1.1 } },
      })
      return (
        <div {...parent()} data-testid="parent">
          <parent.Provider>
            <Child />
          </parent.Provider>
        </div>
      )
    })
    const parentEl = getByTestId("parent")
    animateSpy.mockClear()

    fireEvent.pointerEnter(parentEl)

    // Child animates to opacity=0.5 from inherited "big" label resolved
    // in child's own variants. Filter by `opacity` (parent doesn't animate
    // opacity) to isolate child's call.
    const childCall = animateSpy.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.opacity === 0.5,
    )
    expect(childCall).toBeDefined()
    unmount()
  })

  it("controlling child does NOT inherit parent's hover (its own animate makes it controlling)", () => {
    // Child has `animate: "rest"` as a label — IS controlling.
    // Should NOT inherit from parent. opacity stays at child's animate's "rest".
    function Child() {
      const m = useMotion({
        animate: "rest",
        variants: { rest: { opacity: 1 }, big: { opacity: 0.5 } },
      })
      return <div {...m()} data-testid="child" />
    }
    const { getByTestId, unmount } = render(() => {
      const parent = useMotion({
        animate: "rest",
        hover: "big",
        variants: { rest: { scale: 1 }, big: { scale: 1.1 } },
      })
      return (
        <div {...parent()} data-testid="parent">
          <parent.Provider>
            <Child />
          </parent.Provider>
        </div>
      )
    })
    const parentEl = getByTestId("parent")
    animateSpy.mockClear()

    fireEvent.pointerEnter(parentEl)

    // No animate call with opacity=0.5 — child is controlling, doesn't
    // inherit parent's "big" label.
    const inheritedCall = animateSpy.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.opacity === 0.5,
    )
    expect(inheritedCall).toBeUndefined()
    unmount()
  })

  it("child without Provider does NOT inherit (Q4 sub-3 Option B)", () => {
    // No Provider wrapping the child — bare useMotion is a pure consumer
    // of the context above it (which doesn't carry the parent's gesture).
    function Child() {
      const m = useMotion({
        variants: { rest: { opacity: 1 }, big: { opacity: 0.5 } },
      })
      return <div {...m()} data-testid="child" />
    }
    const { getByTestId, unmount } = render(() => {
      const parent = useMotion({
        animate: "rest",
        hover: "big",
        variants: { rest: { scale: 1 }, big: { scale: 1.1 } },
      })
      return (
        <div {...parent()} data-testid="parent">
          {/* no Provider — child has no inheritance path */}
          <Child />
        </div>
      )
    })
    const parentEl = getByTestId("parent")
    animateSpy.mockClear()

    fireEvent.pointerEnter(parentEl)

    const inheritedCall = animateSpy.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.opacity === 0.5,
    )
    expect(inheritedCall).toBeUndefined()
    unmount()
  })

  it("non-controlling child reverts when parent stops hovering", () => {
    function Child() {
      const m = useMotion({
        variants: { rest: { opacity: 1 }, big: { opacity: 0.5 } },
      })
      return <div {...m()} data-testid="child" />
    }
    const { getByTestId, unmount } = render(() => {
      const parent = useMotion({
        animate: "rest",
        hover: "big",
        variants: { rest: { scale: 1 }, big: { scale: 1.1 } },
      })
      return (
        <div {...parent()} data-testid="parent">
          <parent.Provider>
            <Child />
          </parent.Provider>
        </div>
      )
    })
    const parentEl = getByTestId("parent")
    fireEvent.pointerEnter(parentEl)
    animateSpy.mockClear()

    fireEvent.pointerLeave(parentEl)

    // Child should animate opacity back. Since child has no own animate,
    // and parent's "rest" propagates via the now-inactive whileHover
    // fallback chain, the removed-key path applies: opacity falls back to
    // motion default (1).
    const childRevert = animateSpy.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.opacity === 1,
    )
    expect(childRevert).toBeDefined()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Press, focus, inView propagate via the same mechanism.
// ---------------------------------------------------------------------------

describe("variant inheritance — press, focus, inView", () => {
  it("press propagates from parent to non-controlling child", () => {
    function Child() {
      const m = useMotion({
        variants: { rest: { opacity: 1 }, down: { opacity: 0.5 } },
      })
      return <div {...m()} data-testid="child" />
    }
    const { getByTestId, unmount } = render(() => {
      const parent = useMotion({
        animate: "rest",
        press: "down",
        variants: { rest: { scale: 1 }, down: { scale: 0.95 } },
      })
      return (
        <div {...parent()} data-testid="parent">
          <parent.Provider>
            <Child />
          </parent.Provider>
        </div>
      )
    })
    const parentEl = getByTestId("parent")
    animateSpy.mockClear()

    fireEvent.pointerDown(parentEl, { pointerId: 1, button: 0, isPrimary: true })

    const childCall = animateSpy.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.opacity === 0.5,
    )
    expect(childCall).toBeDefined()
    unmount()
  })

  it("focus propagates from parent to non-controlling child", () => {
    function Child() {
      const m = useMotion({
        variants: { rest: { opacity: 1 }, ring: { opacity: 0.5 } },
      })
      return <span {...m()} data-testid="child" />
    }
    const { getByTestId, unmount } = render(() => {
      const parent = useMotion({
        animate: "rest",
        focus: "ring",
        variants: { rest: { scale: 1 }, ring: { scale: 1.1 } },
      })
      return (
        <button {...parent()} data-testid="parent" type="button">
          <parent.Provider>
            <Child />
          </parent.Provider>
        </button>
      )
    })
    const parentEl = getByTestId("parent") as HTMLButtonElement
    animateSpy.mockClear()

    parentEl.focus()
    fireEvent.focus(parentEl)

    const childCall = animateSpy.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.opacity === 0.5,
    )
    expect(childCall).toBeDefined()
    unmount()
  })

  it("inView propagates from parent to non-controlling child", () => {
    function Child() {
      const m = useMotion({
        variants: { rest: { opacity: 0 }, visible: { opacity: 1 } },
      })
      return <div {...m()} data-testid="child" />
    }
    const { getByTestId, unmount } = render(() => {
      const parent = useMotion({
        animate: "rest",
        inView: "visible",
        variants: { rest: { y: 20 }, visible: { y: 0 } },
      })
      return (
        <div {...parent()} data-testid="parent">
          <parent.Provider>
            <Child />
          </parent.Provider>
        </div>
      )
    })
    const parentEl = getByTestId("parent")
    animateSpy.mockClear()

    fireIntersection(parentEl, true)

    const childCall = animateSpy.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.opacity === 1,
    )
    expect(childCall).toBeDefined()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// isControllingVariants — node-level opt-out from inheritance.
// ---------------------------------------------------------------------------

describe("isControllingVariants — node-level opt-out", () => {
  it("child with own animate LABEL is controlling and doesn't inherit", () => {
    // animate: "other" (a label, not a Target object) makes child controlling.
    function Child() {
      const m = useMotion({
        animate: "other",
        variants: { other: { opacity: 0.7 }, big: { opacity: 0.5 } },
      })
      return <div {...m()} data-testid="child" />
    }
    const { getByTestId, unmount } = render(() => {
      const parent = useMotion({
        animate: "rest",
        hover: "big",
        variants: { rest: { scale: 1 }, big: { scale: 1.1 } },
      })
      return (
        <div {...parent()} data-testid="parent">
          <parent.Provider>
            <Child />
          </parent.Provider>
        </div>
      )
    })
    const parentEl = getByTestId("parent")
    animateSpy.mockClear()

    fireEvent.pointerEnter(parentEl)

    // Child should NOT have animated to opacity=0.5 (parent's "big").
    const inherited = animateSpy.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.opacity === 0.5,
    )
    expect(inherited).toBeUndefined()
    unmount()
  })

  it("child with animate as Target OBJECT is NOT controlling and inherits gestures", () => {
    // animate: { opacity: 0.7 } is a Target object — does NOT make child
    // controlling per motion-dom's rule. Child still inherits parent's
    // gesture cascade.
    function Child() {
      const m = useMotion({
        animate: { opacity: 0.7 },
        variants: { rest: { opacity: 1 }, big: { opacity: 0.5 } },
      })
      return <div {...m()} data-testid="child" />
    }
    const { getByTestId, unmount } = render(() => {
      const parent = useMotion({
        animate: "rest",
        hover: "big",
        variants: { rest: { scale: 1 }, big: { scale: 1.1 } },
      })
      return (
        <div {...parent()} data-testid="parent">
          <parent.Provider>
            <Child />
          </parent.Provider>
        </div>
      )
    })
    const parentEl = getByTestId("parent")
    animateSpy.mockClear()

    fireEvent.pointerEnter(parentEl)

    // Child animates to opacity=0.5 because it's NOT controlling and
    // inherits parent's hover label.
    const inherited = animateSpy.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.opacity === 0.5,
    )
    expect(inherited).toBeDefined()
    unmount()
  })

  it("child's own hover gesture wins when both child and parent are hovered", () => {
    // Child has own `hover: "small"` AND parent has `hover: "big"`. Both
    // hovered. Child is controlling (has own hover label) — doesn't
    // inherit parent. Child's own "small" applies when child is hovered.
    function Child() {
      const m = useMotion({
        hover: "small",
        variants: { rest: { opacity: 1 }, small: { opacity: 0.3 }, big: { opacity: 0.5 } },
      })
      return <div {...m()} data-testid="child" />
    }
    const { getByTestId, unmount } = render(() => {
      const parent = useMotion({
        animate: "rest",
        hover: "big",
        variants: { rest: { scale: 1 }, big: { scale: 1.1 } },
      })
      return (
        <div {...parent()} data-testid="parent">
          <parent.Provider>
            <Child />
          </parent.Provider>
        </div>
      )
    })
    const parentEl = getByTestId("parent")
    const childEl = getByTestId("child")
    animateSpy.mockClear()

    fireEvent.pointerEnter(parentEl)
    fireEvent.pointerEnter(childEl)

    // Child uses its OWN "small" — opacity=0.3.
    const ownCall = animateSpy.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.opacity === 0.3,
    )
    expect(ownCall).toBeDefined()
    // Inherited "big" did NOT apply (child is controlling).
    const inheritedCall = animateSpy.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.opacity === 0.5,
    )
    expect(inheritedCall).toBeUndefined()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Non-gesture slots: when non-controlling, the parent's animate label also
// propagates (no gesture activation needed — animate is the baseline state).
// ---------------------------------------------------------------------------

describe("variant inheritance — animate label propagation", () => {
  it("non-controlling child inherits parent's animate label on mount", () => {
    function Child() {
      const m = useMotion({
        // No own animate — should inherit parent's "on".
        variants: { off: { opacity: 0 }, on: { opacity: 1 } },
      })
      return <div {...m()} data-testid="child" />
    }
    const { unmount } = render(() => {
      const parent = useMotion({
        animate: "on",
        variants: { off: { scale: 0.8 }, on: { scale: 1 } },
      })
      return (
        <div {...parent()}>
          <parent.Provider>
            <Child />
          </parent.Provider>
        </div>
      )
    })

    // Child should animate to opacity=1 from inherited "on" label.
    const childCall = animateSpy.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.opacity === 1,
    )
    expect(childCall).toBeDefined()
    unmount()
  })
})
