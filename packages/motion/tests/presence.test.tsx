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
