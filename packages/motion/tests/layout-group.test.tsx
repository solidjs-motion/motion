import { render } from "@solidjs/testing-library"
import { type Accessor, createEffect, createRoot, createSignal, useContext } from "solid-js"
import { describe, expect, it } from "vitest"
import { rootLayoutCoordinator } from "../src/layout-coordinator"
import { LayoutGroup } from "../src/layout-group"
import { LayoutGroupContext } from "../src/layout-group-context"
import type { LayoutCoordinator, LayoutGroupContextValue } from "../src/types"

const flushMicrotasks = () => new Promise<void>((r) => queueMicrotask(r))

describe("LayoutGroupContext default", () => {
  it("provides rootLayoutCoordinator and a constant broadcast accessor", () => {
    let captured: LayoutGroupContextValue | undefined
    createRoot((dispose) => {
      captured = useContext(LayoutGroupContext)
      dispose()
    })
    expect(captured?.coordinator).toBe(rootLayoutCoordinator)
    // Constant accessor — always returns 0; subscribers run once on
    // creation but never re-fire from this source.
    expect(captured?.broadcast()).toBe(0)
  })
})

describe("LayoutGroup", () => {
  it("provides a fresh coordinator distinct from the root", () => {
    let captured: LayoutCoordinator | undefined
    function Probe() {
      const ctx = useContext(LayoutGroupContext)
      captured = ctx.coordinator
      return null
    }
    render(() => (
      <LayoutGroup>
        <Probe />
      </LayoutGroup>
    ))
    expect(captured).not.toBe(rootLayoutCoordinator)
    expect(captured).toBeDefined()
  })

  it("renders children as a fragment (no DOM wrapper)", () => {
    const { container } = render(() => (
      <LayoutGroup>
        <span data-testid="child">hello</span>
      </LayoutGroup>
    ))
    // The container's direct child should be the <span>, NOT a wrapper.
    expect(container.firstElementChild?.tagName).toBe("SPAN")
  })

  it("bumps the broadcast counter when dependency changes", async () => {
    const [dep, setDep] = createSignal(0)
    // Default no-op accessor so type stays `Accessor<number>` (avoids
    // `!` assertions in the assertions below).
    let broadcastAccessor: Accessor<number> = () => 0
    function Probe() {
      broadcastAccessor = useContext(LayoutGroupContext).broadcast
      return null
    }
    render(() => (
      <LayoutGroup dependency={dep}>
        <Probe />
      </LayoutGroup>
    ))
    await flushMicrotasks()
    // First iteration of createComputed bumped 0 → 1 (harmless baseline).
    const initial = broadcastAccessor()

    setDep(1)
    await flushMicrotasks()
    expect(broadcastAccessor()).toBe(initial + 1)

    setDep(2)
    await flushMicrotasks()
    expect(broadcastAccessor()).toBe(initial + 2)
  })

  it("notifies subscribers via createEffect on each dependency change", async () => {
    const [dep, setDep] = createSignal(0)
    const observed: number[] = []
    function Probe() {
      const ctx = useContext(LayoutGroupContext)
      createEffect(() => {
        observed.push(ctx.broadcast())
      })
      return null
    }
    render(() => (
      <LayoutGroup dependency={dep}>
        <Probe />
      </LayoutGroup>
    ))
    await flushMicrotasks()
    const initialCount = observed.length

    setDep(1)
    await flushMicrotasks()
    setDep(2)
    await flushMicrotasks()

    // Three additional fires expected (initial dependency-firing
    // counts toward `initialCount`; each setDep is a distinct fire).
    expect(observed.length).toBe(initialCount + 2)
  })

  it("works without a dependency prop (broadcast bumps once on mount and never changes)", async () => {
    let broadcastAccessor: Accessor<number> = () => 0
    function Probe() {
      broadcastAccessor = useContext(LayoutGroupContext).broadcast
      return null
    }
    render(() => (
      <LayoutGroup>
        <Probe />
      </LayoutGroup>
    ))
    await flushMicrotasks()
    const initial = broadcastAccessor()
    // No dependency → no further bumps.
    await flushMicrotasks()
    await flushMicrotasks()
    expect(broadcastAccessor()).toBe(initial)
  })

  describe("nested LayoutGroups", () => {
    it("inner group provides its own coordinator (does not see outer's)", () => {
      let outerCoord: LayoutCoordinator | undefined
      let innerCoord: LayoutCoordinator | undefined
      function OuterProbe() {
        outerCoord = useContext(LayoutGroupContext).coordinator
        return null
      }
      function InnerProbe() {
        innerCoord = useContext(LayoutGroupContext).coordinator
        return null
      }
      render(() => (
        <LayoutGroup>
          <OuterProbe />
          <LayoutGroup>
            <InnerProbe />
          </LayoutGroup>
        </LayoutGroup>
      ))
      expect(outerCoord).toBeDefined()
      expect(innerCoord).toBeDefined()
      expect(innerCoord).not.toBe(outerCoord)
      expect(outerCoord).not.toBe(rootLayoutCoordinator)
    })

    it("outer dependency changes do NOT bump the inner broadcast (scoping isolation)", async () => {
      const [outerDep, setOuterDep] = createSignal(0)
      let innerBroadcast: Accessor<number> = () => 0
      function InnerProbe() {
        innerBroadcast = useContext(LayoutGroupContext).broadcast
        return null
      }
      render(() => (
        <LayoutGroup dependency={outerDep}>
          <LayoutGroup>
            <InnerProbe />
          </LayoutGroup>
        </LayoutGroup>
      ))
      await flushMicrotasks()
      const innerInitial = innerBroadcast()

      setOuterDep(1)
      setOuterDep(2)
      await flushMicrotasks()

      // Inner's broadcast is from the inner group, which has no
      // dependency. Outer's churn must not leak in.
      expect(innerBroadcast()).toBe(innerInitial)
    })

    it("inner dependency changes bump inner broadcast independently of outer", async () => {
      const [outerDep, setOuterDep] = createSignal(0)
      const [innerDep, setInnerDep] = createSignal(0)
      let outerBroadcast: Accessor<number> = () => 0
      let innerBroadcast: Accessor<number> = () => 0
      function OuterProbe() {
        outerBroadcast = useContext(LayoutGroupContext).broadcast
        return null
      }
      function InnerProbe() {
        innerBroadcast = useContext(LayoutGroupContext).broadcast
        return null
      }
      render(() => (
        <LayoutGroup dependency={outerDep}>
          <OuterProbe />
          <LayoutGroup dependency={innerDep}>
            <InnerProbe />
          </LayoutGroup>
        </LayoutGroup>
      ))
      await flushMicrotasks()
      const outerInitial = outerBroadcast()
      const innerInitial = innerBroadcast()

      // Bump inner only.
      setInnerDep(1)
      await flushMicrotasks()
      expect(innerBroadcast()).toBe(innerInitial + 1)
      expect(outerBroadcast()).toBe(outerInitial)

      // Bump outer only.
      setOuterDep(1)
      await flushMicrotasks()
      expect(outerBroadcast()).toBe(outerInitial + 1)
      expect(innerBroadcast()).toBe(innerInitial + 1)
    })
  })
})
