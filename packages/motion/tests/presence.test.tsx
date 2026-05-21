import { render } from "@solidjs/testing-library"
import { createSignal, For, Show } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Spy motion's animate so we can assert which targets the state machine
// dispatched for exit. Thenable behavior (resolves the controls' `then`)
// matters here because Presence awaits `onceExitComplete()` → which awaits
// the animation's `then`. The synchronous-resolve mock keeps tests fast.
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

const { useMotion } = await import("../src/use-motion")
const { Presence, useAnimatePresence } = await import("../src/presence")

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

/**
 * Solid + transition-group dispatch happens across microtasks. Two
 * `Promise.resolve()` awaits is usually enough to flush them; the synchronous
 * thenable on the animate mock means the exit-completion drain is also
 * microtask-bounded.
 */
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

// ---------------------------------------------------------------------------
// Switch path (`<Show>`-style conditional)
// ---------------------------------------------------------------------------

describe("<Presence> — switch path: enter timing", () => {
  it("dispatches the new child's animate IMMEDIATELY in sync mode (parallel with exit)", async () => {
    // Regression: createMotion defers the first-mount animate until presence
    // signals readiness via beforeMount. In sync mode, transition-group's
    // parallel branch fires enterTransition synchronously after exitTransition
    // — so beforeMount fires for the new child in the same tick the swap
    // happens. The new child's animate target should appear in animateSpy
    // calls right away, NOT only after the old child's exit settles.
    const [page, setPage] = createSignal<"a" | "b">("a")
    const { unmount } = render(() => (
      <Presence mode="sync">
        <Show when={page()} keyed>
          {(p) => {
            const m = useMotion({
              initial: { opacity: 0, x: 100 },
              animate: { opacity: 1, x: 0 },
              exit: { opacity: 0, x: -100 },
            })
            return <div {...m()} data-panel={p} />
          }}
        </Show>
      </Presence>
    ))
    await flush()
    animateSpy.mockClear()

    setPage("b")
    // Single microtask flush — the parallel branch shouldn't need the long
    // exit-completion wait that wait mode does.
    await Promise.resolve()
    await Promise.resolve()

    // Both the exit dispatch (target.opacity === 0) and the enter dispatch
    // (target.opacity === 1) should be in animateSpy by now.
    const exitDispatched = animateSpy.mock.calls.some((c) => {
      const t = c[1] as Record<string, unknown>
      return t?.opacity === 0
    })
    const enterDispatched = animateSpy.mock.calls.some((c) => {
      const t = c[1] as Record<string, unknown>
      return t?.opacity === 1
    })
    expect(exitDispatched).toBe(true)
    expect(enterDispatched).toBe(true)

    unmount()
  })
})

describe("<Presence> — nested motion enter timing", () => {
  it("fires enter animate for NESTED motion descendants of the tracked child", async () => {
    // Regression: PresenceContext propagates to every motion descendant,
    // so they all call registerEnter. But transition-group only invokes
    // beforeMount on its direct tracked children — without a subtree
    // walk, nested motion elements' runEnter callbacks would sit in
    // the registry forever and their enter-readiness gate would never
    // flip. Visible symptom: a page-transition wrapper around route
    // content blocks every nested initial→animate (and any gesture
    // animation that depends on the diff effect's first iteration).
    //
    // Mirrors the existing exit-side subtree walk in beforeUnmount.
    const [page, setPage] = createSignal<"a" | "b">("a")
    const { unmount } = render(() => (
      <Presence>
        <Show when={page()} keyed>
          {(p) => {
            // Outer wrapper — the transition-group-tracked element.
            const outer = useMotion({
              initial: { opacity: 0 },
              animate: { opacity: 1 },
              exit: { opacity: 0 },
            })
            // Nested — registers with Presence's runEnters but is NOT
            // a direct tracked child. Without the beforeMount subtree
            // walk, its animate never dispatches.
            const inner = useMotion({
              initial: { y: 20 },
              animate: { y: 0 },
            })
            return (
              <div {...outer()} data-panel={p}>
                <div {...inner()} data-nested="">
                  {p}
                </div>
              </div>
            )
          }}
        </Show>
      </Presence>
    ))
    await flush()

    // First render: nested element's animate target (y: 0) must reach
    // animateSpy. Without the fix it would never be dispatched.
    const nestedAnimate = animateSpy.mock.calls.some((c) => {
      const t = c[1] as Record<string, unknown>
      return t?.y === 0
    })
    expect(nestedAnimate).toBe(true)

    animateSpy.mockClear()
    setPage("b")
    await flush()
    await Promise.resolve()
    await Promise.resolve()

    // Page transition: the new outer + new nested both animate on swap.
    const newNestedAnimate = animateSpy.mock.calls.some((c) => {
      const t = c[1] as Record<string, unknown>
      return t?.y === 0
    })
    expect(newNestedAnimate).toBe(true)

    unmount()
  })
})

describe("<Presence> — switch path", () => {
  it("runs the child's exit animate before the element is removed from the DOM", async () => {
    const [open, setOpen] = createSignal(true)
    const { container, unmount } = render(() => (
      <Presence>
        <Show when={open()}>
          {(_v) => {
            const m = useMotion({
              initial: { opacity: 0 },
              animate: { opacity: 1 },
              exit: { opacity: 0 },
            })
            return <div {...m()} data-testid="content" />
          }}
        </Show>
      </Presence>
    ))

    // Element is initially in the DOM with motion's initial style merged.
    expect(container.querySelector("[data-testid='content']")).not.toBeNull()
    animateSpy.mockClear()

    // Flip the gate. transition-group keeps the element in the DOM until
    // our onExit's `done` fires, which Presence calls AFTER the registered
    // runExit's promise (the exit animate) resolves.
    setOpen(false)
    await flush()

    // motion's animate was called for the exit target. The element's
    // disposal is sequenced AFTER that animate completes.
    const exitCall = animateSpy.mock.calls.find((c) => {
      const target = c[1] as Record<string, unknown>
      return target?.opacity === 0
    })
    expect(exitCall).toBeDefined()

    // After the flush the element should be gone from the DOM.
    expect(container.querySelector("[data-testid='content']")).toBeNull()
    unmount()
  })

  it("passes a non-motion child through without trying to animate", async () => {
    const [open, setOpen] = createSignal(true)
    const { container, unmount } = render(() => (
      <Presence>
        <Show when={open()}>
          <div data-testid="plain">no motion here</div>
        </Show>
      </Presence>
    ))

    expect(container.querySelector("[data-testid='plain']")).not.toBeNull()
    setOpen(false)
    await flush()
    // No registered runExit → done() fires immediately. Element gone.
    expect(container.querySelector("[data-testid='plain']")).toBeNull()
    unmount()
  })

  it("runs exit on PASSIVE motion children via a parent's variant cascade", async () => {
    // Regression: previously `createMotion` only registered a runExit when
    // the child had its OWN `exit` prop. That broke the motion-react
    // canonical orchestration pattern — a parent declares `exit="closed"`,
    // children are passive (only a variants map, no own labels), and the
    // cascade through `m.Provider` is supposed to make children inherit
    // the exit label. Without registration, Presence's subtree-walk found
    // nothing and passive children just vanished on unmount.
    //
    // Fix: registration ALSO triggers when an ancestor's exit label cascades
    // down AND the child has a variants map keyed by that label. The child's
    // runExit then resolves the label against its own variants at exit time.
    const [open, setOpen] = createSignal(true)
    const { container, unmount } = render(() => (
      <Presence>
        <Show when={open()}>
          {(_v) => <Shell />}
        </Show>
      </Presence>
    ))

    function Shell() {
      const m = useMotion({
        initial: "closed",
        animate: "open",
        exit: "closed",
        variants: { open: {}, closed: {} },
      })
      return (
        <ul {...m()} data-testid="shell">
          <m.Provider>
            <PassiveItem />
          </m.Provider>
        </ul>
      )
    }
    function PassiveItem() {
      const m = useMotion({
        variants: {
          open: { opacity: 1 },
          closed: { opacity: 0, x: -77 },
        },
      })
      return <li {...m()} data-testid="passive" />
    }

    expect(container.querySelector("[data-testid='passive']")).not.toBeNull()
    animateSpy.mockClear()

    setOpen(false)
    await flush()

    // PassiveItem has no own exit prop. It inherits "closed" from Shell via
    // m.Provider and resolves its own variants["closed"] = { opacity: 0,
    // x: -77 }. The x: -77 is the smoking gun — it can only come from the
    // passive item's variant, not from Shell (whose variants are empty).
    const passiveExitCall = animateSpy.mock.calls.find((c) => {
      const target = c[1] as Record<string, unknown>
      return target?.x === -77
    })
    expect(passiveExitCall).toBeDefined()

    unmount()
  })

  it("runs exit on NESTED motion descendants when the wrapper unmounts", async () => {
    // Regression: previously Presence only fired runExit on the top-level
    // resolved root. A motion child nested inside a non-motion wrapper
    // (e.g., a dialog inside a positioning div, or any parent-cascade
    // orchestration pattern) would be removed instantly with no exit.
    // The fix has Presence walk the subtree and fire every registered
    // runExit it finds — matching motion-react's behavior where the whole
    // subtree animates out together.
    const [open, setOpen] = createSignal(true)
    const { container, unmount } = render(() => (
      <Presence>
        <Show when={open()}>
          {(_v) => (
            <div data-testid="wrapper">
              {(() => {
                // Nested motion child INSIDE the non-motion wrapper.
                const m = useMotion({
                  initial: { opacity: 0 },
                  animate: { opacity: 1 },
                  exit: { opacity: 0, x: 100 },
                })
                return <span {...m()} data-testid="nested" />
              })()}
            </div>
          )}
        </Show>
      </Presence>
    ))

    expect(container.querySelector("[data-testid='wrapper']")).not.toBeNull()
    expect(container.querySelector("[data-testid='nested']")).not.toBeNull()
    animateSpy.mockClear()

    setOpen(false)
    await flush()

    // The nested motion child's exit MUST have dispatched — its `x: 100`
    // is the smoking gun (the wrapper has no motion of its own).
    const exitCall = animateSpy.mock.calls.find((c) => {
      const target = c[1] as Record<string, unknown>
      return target?.x === 100
    })
    expect(exitCall).toBeDefined()

    // After the exit settles, the whole subtree should be removed.
    expect(container.querySelector("[data-testid='wrapper']")).toBeNull()
    expect(container.querySelector("[data-testid='nested']")).toBeNull()

    unmount()
  })

  it("immediately unmounts a motion child that has no `exit` defined", async () => {
    const [open, setOpen] = createSignal(true)
    const { container, unmount } = render(() => (
      <Presence>
        <Show when={open()}>
          {(_v) => {
            // animate but NO exit — child registers nothing with Presence.
            const m = useMotion({ animate: { opacity: 1 } })
            return <div {...m()} data-testid="content" />
          }}
        </Show>
      </Presence>
    ))
    setOpen(false)
    await flush()
    expect(container.querySelector("[data-testid='content']")).toBeNull()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// List path (`<For>`-style iteration)
// ---------------------------------------------------------------------------

describe("<Presence> — list path", () => {
  it("renders every item when the list starts empty (path decision must defer)", async () => {
    // Regression: when the For starts empty, `resolved()` is null. The
    // path-decision used to lock into switch mode on construction —
    // `Array.isArray(null)` is false — and every subsequent For item past
    // the first would silently never enter the DOM. The toast queue demo
    // hit this exactly: fire four toasts, only the first rendered. The
    // fix defers the decision until the first non-null source emit.
    type Item = { id: number }
    const [items, setItems] = createSignal<Item[]>([])
    const { container, unmount } = render(() => (
      <Presence>
        <For each={items()}>
          {(item) => {
            const m = useMotion({
              initial: { opacity: 0 },
              animate: { opacity: 1 },
              exit: { opacity: 0 },
            })
            return <div {...m()} data-id={String(item.id)} />
          }}
        </For>
      </Presence>
    ))
    // Empty start: no items rendered.
    expect(container.querySelectorAll("[data-id]")).toHaveLength(0)

    // Add four items in a single tick.
    setItems([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }])
    await flush()

    // All four must render — not just the first.
    expect(container.querySelectorAll("[data-id]")).toHaveLength(4)
    expect(container.querySelector("[data-id='1']")).not.toBeNull()
    expect(container.querySelector("[data-id='4']")).not.toBeNull()

    unmount()
  })

  it("runs exit on a removed item without affecting unchanged items", async () => {
    type Item = { id: number }
    const [items, setItems] = createSignal<Item[]>([{ id: 1 }, { id: 2 }, { id: 3 }])
    const { container, unmount } = render(() => (
      <Presence>
        <For each={items()}>
          {(item) => {
            const m = useMotion({
              initial: { opacity: 0 },
              animate: { opacity: 1 },
              exit: { opacity: 0 },
            })
            return <div {...m()} data-id={String(item.id)} />
          }}
        </For>
      </Presence>
    ))

    expect(container.querySelectorAll("[data-id]")).toHaveLength(3)
    animateSpy.mockClear()

    // Remove item id=2.
    setItems((prev) => prev.filter((i) => i.id !== 2))
    await flush()

    // The removed item's exit ran. Filter for `opacity: 0` calls.
    const exitCalls = animateSpy.mock.calls.filter((c) => {
      const target = c[1] as Record<string, unknown>
      return target?.opacity === 0
    })
    expect(exitCalls.length).toBeGreaterThan(0)

    // After the flush, only items 1 and 3 remain.
    expect(container.querySelectorAll("[data-id]")).toHaveLength(2)
    expect(container.querySelector("[data-id='2']")).toBeNull()
    unmount()
  })

  it("exits multiple removed items in parallel (Promise.all coordination)", async () => {
    type Item = { id: number }
    // Items must be referentially stable across updates — Solid's <For>
    // identifies items by object identity. Building the next array via
    // .filter() preserves the surviving references; replacing with a fresh
    // object literal would tell <For> that ALL items changed and trigger
    // exits on every motion child (including the "unchanged" one).
    const initial: Item[] = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const [items, setItems] = createSignal<Item[]>(initial)
    const { container, unmount } = render(() => (
      <Presence>
        <For each={items()}>
          {(item) => {
            const m = useMotion({ animate: { opacity: 1 }, exit: { opacity: 0 } })
            return <div {...m()} data-id={String(item.id)} />
          }}
        </For>
      </Presence>
    ))
    animateSpy.mockClear()

    // Remove both 1 and 3 in the same tick — but keep item 2's identity.
    setItems((prev) => prev.filter((i) => i.id === 2))
    await flush()

    const exitCalls = animateSpy.mock.calls.filter((c) => {
      const target = c[1] as Record<string, unknown>
      return target?.opacity === 0
    })
    // Two exit animations fire — one per removed item.
    expect(exitCalls.length).toBe(2)
    expect(container.querySelectorAll("[data-id]")).toHaveLength(1)
    expect(container.querySelector("[data-id='2']")).not.toBeNull()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// `initial` prop — suppresses first-mount animation
// ---------------------------------------------------------------------------

describe("<Presence initial={false}>", () => {
  it("suppresses the first-mount animate for contained motion children", async () => {
    animateSpy.mockClear()
    const { unmount } = render(() => (
      <Presence initial={false}>
        <Show when={true}>
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
    await flush()

    // No animate call for the initial mount target (opacity: 1) should have
    // fired. The state machine's `suppressFirstMount` seeded lastApplied
    // from current winners and skipped the dispatch.
    const enterCalls = animateSpy.mock.calls.filter((c) => {
      const target = c[1] as Record<string, unknown>
      return target?.opacity === 1
    })
    expect(enterCalls.length).toBe(0)
    unmount()
  })

  it("renders the child painted at its animate target (NOT initial) when suppressing", async () => {
    // Bug regression: suppressFirstMount used to skip animate but leave the
    // JSX-rendered style at the initial target — the element would mount
    // invisible (opacity: 0) and never animate to opacity:1. The fix is to
    // make useMotion's computeInitialStyle pick the animate target when
    // presence.initial?.() is false; the state machine still skips the
    // first dispatch. End-to-end: the element should paint at opacity:1
    // immediately, without an animate call.
    const { container, unmount } = render(() => (
      <Presence initial={false}>
        <Show when={true}>
          {(_v) => {
            const m = useMotion({
              initial: { opacity: 0, x: 24 },
              animate: { opacity: 1, x: 0 },
              exit: { opacity: 0 },
            })
            return <div {...m()} data-testid="suppressed" />
          }}
        </Show>
      </Presence>
    ))
    await flush()

    const el = container.querySelector("[data-testid='suppressed']") as HTMLElement | null
    // The JSX-merged style should reflect the animate target, not initial.
    expect(el?.style.opacity).toBe("1")
    // x: 0 → transform: none / translate3d(0, ...). Just assert opacity here;
    // transform string format is jsdom-version-dependent.
    unmount()
  })

  it("still runs mid-life animations after the first-mount suppression", async () => {
    const [phase, setPhase] = createSignal<"idle" | "active">("idle")
    const { unmount } = render(() => (
      <Presence initial={false}>
        <Show when={true}>
          {(_v) => {
            const m = useMotion(() => ({
              animate: phase() === "active" ? { opacity: 1 } : { opacity: 0.3 },
            }))
            return <div {...m()} />
          }}
        </Show>
      </Presence>
    ))
    await flush()
    animateSpy.mockClear()

    setPhase("active")
    await flush()

    // The mid-life signal-driven change SHOULD animate.
    const activeCalls = animateSpy.mock.calls.filter((c) => {
      const target = c[1] as Record<string, unknown>
      return target?.opacity === 1
    })
    expect(activeCalls.length).toBeGreaterThan(0)
    unmount()
  })
})

// ---------------------------------------------------------------------------
// useAnimatePresence — imperative hook
// ---------------------------------------------------------------------------

describe("useAnimatePresence()", () => {
  it("exit() runs registered children's exits and resolves when settled", async () => {
    let presence!: ReturnType<typeof useAnimatePresence>
    const { container, unmount } = render(() => {
      presence = useAnimatePresence()
      return (
        <presence.Provider>
          {(() => {
            const m = useMotion({
              animate: { opacity: 1 },
              exit: { opacity: 0 },
            })
            return <div {...m()} data-testid="child" />
          })()}
        </presence.Provider>
      )
    })

    expect(container.querySelector("[data-testid='child']")).not.toBeNull()
    animateSpy.mockClear()

    // Imperatively trigger exit. Doesn't unmount on its own — the user is
    // responsible for that (typical pattern: await exit(), then flip mount).
    await presence.exit()

    // The exit animation was dispatched.
    const exitCalls = animateSpy.mock.calls.filter((c) => {
      const target = c[1] as Record<string, unknown>
      return target?.opacity === 0
    })
    expect(exitCalls.length).toBeGreaterThan(0)
    // The element is STILL in the DOM — the hook coordinates exits but
    // doesn't remove anything. Caller's responsibility.
    expect(container.querySelector("[data-testid='child']")).not.toBeNull()
    unmount()
  })

  it("exit() resolves immediately when no children are registered", async () => {
    let presence!: ReturnType<typeof useAnimatePresence>
    const { unmount } = render(() => {
      presence = useAnimatePresence()
      return <presence.Provider>{null}</presence.Provider>
    })
    await expect(presence.exit()).resolves.toBeUndefined()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Regression — exit overrides drag's x/y claim
// (gesture-state.ts line 224 patch)
// ---------------------------------------------------------------------------

describe("<Presence> — drag-during-exit regression", () => {
  it("lets exit's x reach DOM even when `drag` is enabled (exit > drag in priority)", async () => {
    const [open, setOpen] = createSignal(true)
    const { unmount } = render(() => (
      <Presence>
        <Show when={open()}>
          {(_v) => {
            // drag enabled, but the element is unmounting — exit's x should win.
            const m = useMotion({
              animate: { opacity: 1 },
              drag: true,
              exit: { x: 200, opacity: 0 },
            })
            return <div {...m()} />
          }}
        </Show>
      </Presence>
    ))
    await flush()
    animateSpy.mockClear()

    setOpen(false)
    await flush()

    // Find the exit animate call — it should include `x: 200`. Without the
    // patch, the drag-x/y exclusion would have filtered x out, leaving
    // only opacity in the dispatched target.
    const exitCallWithX = animateSpy.mock.calls.find((c) => {
      const target = c[1] as Record<string, unknown>
      return target?.x === 200
    })
    expect(exitCallWithX).toBeDefined()
    unmount()
  })
})
