import { Show } from "solid-js"
import { renderToString } from "solid-js/web"
import { describe, expect, it } from "vitest"
import { Presence } from "../../src/presence"
import { useMotion } from "../../src/use-motion"

// Run under the SSR vitest config — solid-js/web resolves to the server
// build and renderToString emits real HTML.
//
// These tests pin Presence's SSR behavior. Presence is otherwise a
// client-only coordinator (its `isServer` short-circuit at the top
// short-circuits to pass-through children), but it ALSO threads its
// `initial` prop through PresenceContext so useMotion can compute its
// SSR-emittable initial style differently when the surrounding Presence
// is `initial={false}`.

describe("<Presence> SSR — children render pass-through", () => {
  it("server-renders motion children normally — initial style in HTML", () => {
    const html = renderToString(() => (
      <Presence>
        <Show when={true}>
          {(_v) => {
            const m = useMotion({
              initial: { opacity: 0, y: 20 },
              animate: { opacity: 1, y: 0 },
            })
            return <div {...m()}>card</div>
          }}
        </Show>
      </Presence>
    ))
    expect(html).toContain("opacity:0")
    expect(html).toContain("translateY(20px)")
    expect(html).toContain("data-motion-hydrated")
  })
})

describe("<Presence initial={false}> SSR — children paint at the animate target", () => {
  it("emits the ANIMATE target's style (not the initial's) when the surrounding Presence has initial={false}", () => {
    // Phase 3 contract: `initial={false}` propagates suppression through
    // PresenceContext.initial. useMotion's computeInitialStyle picks the
    // animate target's style instead of the initial's so the SSR HTML
    // matches the post-animation visual state — no enter animation runs
    // on hydration, but the user never sees the pre-animation frame.
    const html = renderToString(() => (
      <Presence initial={false}>
        <Show when={true}>
          {(_v) => {
            const m = useMotion({
              initial: { opacity: 0, y: 20 },
              animate: { opacity: 1, y: 0 },
            })
            return <div {...m()}>card</div>
          }}
        </Show>
      </Presence>
    ))
    // The animate target's style is opacity:1 + transform:translateY(0).
    expect(html).toContain("opacity:1")
    // initial's opacity:0 must NOT appear.
    expect(html).not.toMatch(/opacity:\s*0[^.]/)
    // translateY(20px) was the initial; the animate is translateY(0).
    expect(html).not.toContain("translateY(20px)")
  })

  it("still emits data-motion-hydrated so client createMotion skips applyStaticStyle on rehydrate", () => {
    const html = renderToString(() => (
      <Presence initial={false}>
        <Show when={true}>
          {(_v) => {
            const m = useMotion({
              initial: { opacity: 0 },
              animate: { opacity: 1 },
            })
            return <div {...m()} />
          }}
        </Show>
      </Presence>
    ))
    expect(html).toContain("data-motion-hydrated")
  })
})
