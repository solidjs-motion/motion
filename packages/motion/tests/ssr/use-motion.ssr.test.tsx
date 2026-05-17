import { renderToString } from "solid-js/web"
import { describe, expect, it } from "vitest"
import { useMotion } from "../../src/use-motion"

// Run under conditions: ["development", "node"] (see vitest.ssr.config.ts) so
// solid-js/web resolves to the server build and renderToString emits real HTML.

describe("useMotion SSR — initial style emission", () => {
  it("emits the initial style inline alongside the data-motion-hydrated marker", () => {
    const html = renderToString(() => {
      const m = useMotion({ initial: { opacity: 0, y: 20 } })
      return <div {...m({ class: "card" })}>hello</div>
    })
    expect(html).toContain("opacity:0")
    expect(html).toContain("translateY(20px)")
    expect(html).toContain("data-motion-hydrated")
    // Solid's SSR may emit class with a trailing space; tolerate it.
    expect(html).toMatch(/class="card\s*"/)
  })

  it("omits data-motion-hydrated when initial:false", () => {
    const html = renderToString(() => {
      const m = useMotion({ initial: false, animate: { opacity: 1 } })
      return <div {...m()}>hi</div>
    })
    expect(html).not.toContain("data-motion-hydrated")
  })

  it("derives initial style from animate when initial is unset", () => {
    const html = renderToString(() => {
      const m = useMotion({ animate: { x: 50, opacity: 0.5 } })
      return <div {...m()}>x</div>
    })
    expect(html).toContain("translateX(50px)")
    expect(html).toContain("opacity:0.5")
  })

  it("merges user style with motion's, motion-wins on conflict", () => {
    const html = renderToString(() => {
      const m = useMotion({ initial: { opacity: 0 } })
      return <div {...m({ style: { opacity: 0.5, padding: "1rem" } })}>x</div>
    })
    // motion's opacity:0 wins over user's 0.5
    expect(html).toContain("opacity:0")
    expect(html).not.toContain("opacity:0.5")
    // user's padding passes through
    expect(html).toContain("padding:1rem")
  })

  it("produces byte-identical HTML for repeated server renders (determinism)", () => {
    const view = () => {
      const m = useMotion({ initial: { opacity: 0, x: 10, scale: 0.9 } })
      return <div {...m()}>x</div>
    }
    const a = renderToString(view)
    const b = renderToString(view)
    const c = renderToString(view)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })
})

describe("useMotion SSR — variant propagation through m.Provider", () => {
  // Variant propagation only works when the child's useMotion is called inside
  // a sub-component rendered within the parent's Provider — otherwise the
  // child's useMotion runs in the parent component's body, before m.Provider
  // sets up context for its JSX subtree.
  const ChildSpan = (props: { variants: Record<string, { x?: number; opacity?: number }> }) => {
    const m = useMotion({ variants: props.variants })
    return <span {...m()}>child</span>
  }

  it("a child rendered inside m.Provider inherits the parent's initial variant name", () => {
    const html = renderToString(() => {
      const parent = useMotion({
        initial: "hidden",
        animate: "visible",
        variants: { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } },
      })
      return (
        <div {...parent()}>
          <parent.Provider>
            {/* Pattern X: child has its OWN variants definition. The variant
                NAME ("hidden") propagates through context; the SHAPE comes
                from the child's variants map. */}
            <ChildSpan variants={{ hidden: { x: 100 }, visible: { x: 0 } }} />
          </parent.Provider>
        </div>
      )
    })
    // Parent serialized with its own "hidden" target.
    expect(html).toContain("opacity:0")
    expect(html).toContain("translateY(20px)")
    // Child resolves the inherited "hidden" through its OWN variants:
    // x: 100, NOT the parent's { opacity: 0, y: 20 }.
    expect(html).toContain("translateX(100px)")
  })

  it("a child outside m.Provider does NOT inherit the parent's variant name", () => {
    const html = renderToString(() => {
      const parent = useMotion({
        initial: "hidden",
        variants: { hidden: { opacity: 0 } },
      })
      return (
        <div {...parent()}>
          {/* No Provider wrap — child sees no variant context. */}
          <ChildSpan variants={{ hidden: { x: 100 } }} />
        </div>
      )
    })
    // Parent's "hidden" lands.
    expect(html).toContain("opacity:0")
    // Child has no own initial and no inherited name — no initial style.
    expect(html).not.toContain("translateX(100px)")
  })

  it("a child with explicit initial Target overrides the inherited variant name", () => {
    const ChildWithExplicit = () => {
      const m = useMotion({
        initial: { rotate: 90 },
        variants: { visible: { x: 999 } }, // would land if inherited
      })
      return <span {...m()}>child</span>
    }
    const html = renderToString(() => {
      const parent = useMotion({
        initial: "visible",
        variants: { visible: { opacity: 1 } },
      })
      return (
        <div {...parent()}>
          <parent.Provider>
            <ChildWithExplicit />
          </parent.Provider>
        </div>
      )
    })
    // Child uses its explicit initial, NOT the inherited "visible" → x: 999.
    expect(html).toContain("rotate(90deg)")
    expect(html).not.toContain("translateX(999px)")
  })
})

describe("useMotion SSR — purity / hydration mismatch protection", () => {
  it("renders the same HTML on three successive SSR passes regardless of order", () => {
    const view = () => {
      const a = useMotion({ initial: { x: 10 } })
      const b = useMotion({ initial: { y: 20 } })
      const c = useMotion({ initial: { scale: 0.5 } })
      return (
        <main>
          <div {...a()} />
          <span {...b()} />
          <em {...c()} />
        </main>
      )
    }
    const r1 = renderToString(view)
    const r2 = renderToString(view)
    const r3 = renderToString(view)
    expect(r1).toBe(r2)
    expect(r2).toBe(r3)
  })

  it("variant resolution is deterministic across SSR passes", () => {
    const variants = {
      hidden: { opacity: 0, y: 20 },
      visible: { opacity: 1, y: 0 },
    }
    const view = () => {
      const m = useMotion({ initial: "hidden", animate: "visible", variants })
      return <div {...m()}>x</div>
    }
    const a = renderToString(view)
    const b = renderToString(view)
    expect(a).toBe(b)
  })
})
