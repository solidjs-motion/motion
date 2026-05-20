import { render } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock motion's animate so the tag-component tests don't fire real WAA
// animations in jsdom. The thenable resolve keeps anything awaiting on
// the controls (presence integration, etc.) synchronous.
const animateSpy = vi.fn((..._args: unknown[]) => ({
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
}))

vi.mock("motion", async () => {
  const actual = await vi.importActual<typeof import("motion")>("motion")
  return { ...actual, animate: animateSpy }
})

const { MOTION_OPT_KEYS, motion } = await import("../src/motion-proxy")
const { useMotion } = await import("../src/use-motion")

beforeEach(() => {
  animateSpy.mockClear()
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

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

// ---------------------------------------------------------------------------
// Tag-component rendering
// ---------------------------------------------------------------------------

describe("motion.X tag-component", () => {
  it("motion.div renders an HTMLDivElement", () => {
    const { container, unmount } = render(() => <motion.div data-testid="el" />)
    const el = container.querySelector("[data-testid='el']")
    expect(el).toBeInstanceOf(HTMLDivElement)
    unmount()
  })

  it("motion.button renders an HTMLButtonElement and forwards `type`", () => {
    const { container, unmount } = render(() => <motion.button type="submit" data-testid="btn" />)
    const el = container.querySelector("[data-testid='btn']") as HTMLButtonElement | null
    expect(el).toBeInstanceOf(HTMLButtonElement)
    expect(el?.type).toBe("submit")
    unmount()
  })

  it("motion.path renders with the SVG namespace via <Dynamic>", () => {
    const { container, unmount } = render(() => (
      // biome-ignore lint/a11y/noSvgWithoutTitle: namespace check, not a user-facing SVG
      <svg>
        <motion.path d="M0 0 L10 10" data-testid="path" />
      </svg>
    ))
    const el = container.querySelector("[data-testid='path']")
    expect(el?.namespaceURI).toBe("http://www.w3.org/2000/svg")
    expect(el?.tagName.toLowerCase()).toBe("path")
    unmount()
  })

  it("motion.div === motion.div (cached factory identity)", () => {
    // Every read of motion.div returns the same component instance — this
    // matters for Solid's reconciler and for component-identity checks in
    // dev tooling / HMR. Different tags are distinct components.
    expect(motion.div).toBe(motion.div)
    expect(motion.span).toBe(motion.span)
    expect(motion.div).not.toBe(motion.span)
  })

  it("returns undefined for non-string Proxy keys (Symbol, etc.)", () => {
    // Debugging tools and `typeof` checks shouldn't see motion as iterable
    // or fail when they probe well-known symbols.
    expect((motion as unknown as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined()
    expect((motion as unknown as Record<symbol, unknown>)[Symbol.toPrimitive]).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Auto-Provider variant cascade (B1 — locked in ADR 0004)
// ---------------------------------------------------------------------------

describe("motion.X — auto-Provider variant cascade", () => {
  it("propagates the parent's animate label to passive descendants without a manual <m.Provider>", async () => {
    // motion.div has `animate="open"` and `variants`. Inside, a useMotion
    // child has ONLY a variants map (no own animate label) — that's a
    // passive consumer. It should inherit "open" via the auto-Provider
    // and animate to its variants["open"] = { opacity: 1 } target.
    //
    // The smoking gun is that animateSpy was called with `opacity: 1` for
    // the child's element — Shell's own variants["open"] is empty {}, so
    // an opacity:1 call could only come from the passive descendant.
    function PassiveChild() {
      const m = useMotion({
        variants: {
          open: { opacity: 1 },
          closed: { opacity: 0 },
        },
      })
      return <div {...m()} data-testid="child" />
    }

    const { unmount } = render(() => (
      <motion.div initial="closed" animate="open" variants={{ open: {}, closed: {} }}>
        <PassiveChild />
      </motion.div>
    ))
    await flush()

    const opacityOneCall = animateSpy.mock.calls.find((c) => {
      const target = c[1] as Record<string, unknown> | undefined
      return target?.opacity === 1
    })
    expect(opacityOneCall).toBeDefined()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Reactive prop forwarding through the proxy (relies on Option D mergeProps)
// ---------------------------------------------------------------------------

describe("motion.X — reactive non-motion props", () => {
  it("flips `class` on the rendered element when the source signal flips", async () => {
    // The proxy splits MOTION_OPT_KEYS off and spreads `rest` reactively
    // onto the rendered element. `class` is not in MOTION_OPT_KEYS, so it
    // rides through the spread and stays reactive end-to-end.
    const [active, setActive] = createSignal(false)
    const { container, unmount } = render(() => (
      <motion.div class={active() ? "on" : "off"} data-testid="el" />
    ))
    const el = container.querySelector("[data-testid='el']") as HTMLElement
    expect(el.className).toBe("off")

    setActive(true)
    await flush()
    expect(el.className).toBe("on")
    unmount()
  })

  it("merges reactive user style with motion's initial style (motion wins on conflict)", async () => {
    // user.style has `color`, motion's initial has `opacity` via the
    // useMotion initial target. Both should appear in the final inline
    // style. When the color signal flips, the inline color updates.
    const [color, setColor] = createSignal("red")
    const { container, unmount } = render(() => (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{ color: color() }}
        data-testid="el"
      />
    ))
    const el = container.querySelector("[data-testid='el']") as HTMLElement
    expect(el.style.color).toBe("red")
    expect(el.style.opacity).toBe("0")

    setColor("blue")
    await flush()
    expect(el.style.color).toBe("blue")
    unmount()
  })
})

// ---------------------------------------------------------------------------
// MOTION_OPT_KEYS contents
// ---------------------------------------------------------------------------

describe("MOTION_OPT_KEYS", () => {
  it("contains the canonical motion option keys", () => {
    // The compile-time check in motion-proxy.tsx guarantees the list is
    // exhaustive against MotionOptions. This runtime test is a sanity
    // anchor — if someone adds a new MotionOptions key, the TS check
    // fails before this test runs.
    expect(MOTION_OPT_KEYS).toContain("initial")
    expect(MOTION_OPT_KEYS).toContain("animate")
    expect(MOTION_OPT_KEYS).toContain("exit")
    expect(MOTION_OPT_KEYS).toContain("variants")
    expect(MOTION_OPT_KEYS).toContain("transition")
    expect(MOTION_OPT_KEYS).toContain("custom")
    expect(MOTION_OPT_KEYS).toContain("hover")
    expect(MOTION_OPT_KEYS).toContain("press")
    expect(MOTION_OPT_KEYS).toContain("drag")
    expect(MOTION_OPT_KEYS).toContain("dragConstraints")
    expect(MOTION_OPT_KEYS).toContain("onAnimationComplete")
    expect(MOTION_OPT_KEYS).toContain("onDragEnd")
  })

  it("does NOT contain DOM-only attributes / event handlers", () => {
    // The non-motion keys (class, onClick, onSubmit, etc.) must flow
    // through to the rendered element via Solid's reactive spread —
    // they're not motion options.
    const keys = MOTION_OPT_KEYS as readonly string[]
    expect(keys.includes("class")).toBe(false)
    expect(keys.includes("className")).toBe(false)
    expect(keys.includes("onClick")).toBe(false)
    expect(keys.includes("onSubmit")).toBe(false)
    expect(keys.includes("onKeyDown")).toBe(false)
    expect(keys.includes("style")).toBe(false)
    expect(keys.includes("ref")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// motion.create — HOC entry point
// ---------------------------------------------------------------------------

describe("motion.create — HOC", () => {
  it("wraps a Component that spreads {...props} on its DOM root", async () => {
    function MyCard(props: { class?: string; ref?: (el: HTMLElement) => void }) {
      return <div {...props} data-testid="card" />
    }
    const Animated = motion.create(MyCard)
    const { container, unmount } = render(() => (
      <Animated animate={{ opacity: 1 }} class="custom" />
    ))
    const el = container.querySelector("[data-testid='card']") as HTMLElement
    expect(el).toBeInstanceOf(HTMLDivElement)
    // Non-motion class flowed through. The MOTION_OPT_KEYS split kept
    // `class` in `rest`, and Solid's reactive spread put it on the element.
    expect(el.classList.contains("custom")).toBe(true)

    // motion's animate target was dispatched, proving the ref reached the
    // DOM and createMotion ran.
    await flush()
    const animateCall = animateSpy.mock.calls.find((c) => {
      const target = c[1] as Record<string, unknown> | undefined
      return target?.opacity === 1
    })
    expect(animateCall).toBeDefined()
    unmount()
  })

  it("returns Component<P & MotionOptions> — original props preserved", () => {
    // Pure type-level check: the wrapped Component accepts both its own
    // original props (title) AND the full MotionOptions surface. If this
    // didn't typecheck the test file wouldn't load.
    function Titled(props: { title: string; ref?: (el: HTMLElement) => void }) {
      return <div ref={props.ref}>{props.title}</div>
    }
    const Animated = motion.create(Titled)
    const { container, unmount } = render(() => <Animated title="Hello" animate={{ x: 10 }} />)
    expect(container.textContent).toBe("Hello")
    unmount()
  })
})

describe("motion.create — dev-mode warnings", () => {
  it("warns when wrapping motion.X (double-wrap)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const Double = motion.create(motion.div)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/double-wraps/)
    warnSpy.mockRestore()
    // Sanity: Double is still a usable Component — wrap doesn't crash.
    expect(typeof Double).toBe("function")
  })

  it("warns when the wrapped Component doesn't forward props.ref to a DOM root", async () => {
    // BrokenCard ignores props.ref entirely — motion's ref never reaches
    // a DOM element, so animations and exit-registration can't wire up.
    function BrokenCard(_props: { ref?: (el: HTMLElement) => void }) {
      return <div data-testid="broken">no ref forwarded</div>
    }
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const Broken = motion.create(BrokenCard)
    const { unmount } = render(() => <Broken animate={{ opacity: 1 }} />)
    // onMount runs after the first render, then a microtask defers the
    // check itself — flush both.
    await flush()
    await flush()
    expect(warnSpy).toHaveBeenCalled()
    const message = warnSpy.mock.calls[0]?.[0] as string | undefined
    expect(message).toMatch(/didn't receive motion's ref/)
    warnSpy.mockRestore()
    unmount()
  })

  it("does NOT warn when the wrapped Component forwards props.ref correctly", async () => {
    function GoodCard(props: { ref?: (el: HTMLElement) => void }) {
      return <div ref={props.ref} data-testid="good" />
    }
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const Good = motion.create(GoodCard)
    const { unmount } = render(() => <Good animate={{ opacity: 1 }} />)
    await flush()
    await flush()
    // No double-wrap, no broken ref → no warnings at all.
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
    unmount()
  })
})
