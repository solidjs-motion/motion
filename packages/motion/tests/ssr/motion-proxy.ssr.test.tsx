import type { JSX } from "solid-js"
import { renderToString } from "solid-js/web"
import { describe, expect, it } from "vitest"
import { motion } from "../../src/motion-proxy"

// Run under the SSR vitest config — solid-js/web resolves to the server
// build and renderToString emits real HTML. These tests pin Phase 4's
// SSR contract: <motion.div>'s initial style reaches the server-rendered
// HTML AND survives the `renderedOnce`-flag refactor that drops
// initialStyle from m() after the first render's onMount fires (a flag
// that intentionally never flips server-side).

describe("motion.X SSR — initial style emission", () => {
  it("<motion.div> emits initial style inline + data-motion-hydrated marker", () => {
    const html = renderToString(() => (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} class="card">
        hello
      </motion.div>
    ))
    expect(html).toContain("opacity:0")
    expect(html).toContain("translateY(20px)")
    expect(html).toContain("data-motion-hydrated")
    // Solid's SSR may emit class with a trailing space — tolerate it.
    expect(html).toMatch(/class="card\s*"/)
  })

  it("<motion.path> (SVG via Dynamic) still emits initial style inline", () => {
    // SVG path goes through <Dynamic> which createElementNS's into the
    // SVG namespace. The motion-side style merge is unchanged for SVG.
    const html = renderToString(() => (
      <motion.path
        d="M0 0 L10 10"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
      />
    ))
    expect(html).toContain("opacity:0")
    expect(html).toContain("scale(0.9)")
  })

  it("renderedOnce stays false on the server — initial style ALWAYS emitted", () => {
    // The onMount-driven flag never flips server-side because onMount
    // runs in a microtask after the synchronous render, and the server
    // resolves renderToString synchronously. Three repeated renders should
    // all produce identical HTML with the initial style.
    const renderOnce = () =>
      renderToString(() => <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} />)
    const a = renderOnce()
    const b = renderOnce()
    const c = renderOnce()
    expect(a).toContain("opacity:0")
    expect(b).toContain("opacity:0")
    expect(c).toContain("opacity:0")
    expect(a).toBe(b)
    expect(b).toBe(c)
  })
})

describe("motion.create SSR — initial style emission through the HOC", () => {
  it("emits initial style when the wrapped Component spreads {...props} on its root", () => {
    function Card(props: { children?: JSX.Element; ref?: (el: HTMLElement) => void }) {
      return <article {...props}>{props.children}</article>
    }
    const MotionCard = motion.create(Card)
    const html = renderToString(() => (
      <MotionCard initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        body
      </MotionCard>
    ))
    expect(html).toContain("opacity:0")
    expect(html).toContain("translateY(16px)")
    expect(html).toContain("data-motion-hydrated")
  })

  it("user-supplied class on the wrapped Component reaches the SSR HTML", () => {
    function Card(props: {
      children?: JSX.Element
      class?: string
      ref?: (el: HTMLElement) => void
    }) {
      return <article {...props}>{props.children}</article>
    }
    const MotionCard = motion.create(Card)
    const html = renderToString(() => (
      <MotionCard initial={{ opacity: 0 }} animate={{ opacity: 1 }} class="my-card">
        hi
      </MotionCard>
    ))
    expect(html).toMatch(/class="my-card\s*"/)
    expect(html).toContain("opacity:0")
  })
})
