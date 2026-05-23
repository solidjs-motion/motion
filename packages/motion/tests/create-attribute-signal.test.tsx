import { renderHook } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { describe, expect, it } from "vitest"
import { createAttributeSignal } from "../src/primitives/createAttributeSignal"

// Helper: nudge the microtask queue so createEffect's first iteration
// has run before we assert. Solid's createEffect is batched — the
// observer hookup happens one microtask after renderHook returns.
const flushMicrotasks = () => new Promise<void>((r) => queueMicrotask(r))

describe("createAttributeSignal", () => {
  describe("static ref", () => {
    it("starts at 0 and increments on `class` mutation", async () => {
      const el = document.createElement("div")
      document.body.appendChild(el)

      const { result } = renderHook(() => createAttributeSignal(el))
      const tick = result
      expect(tick()).toBe(0)

      await flushMicrotasks()
      el.setAttribute("class", "active")
      // MutationObserver is async; let its microtask run.
      await flushMicrotasks()

      expect(tick()).toBe(1)
      document.body.removeChild(el)
    })

    it("increments on `style` mutation", async () => {
      const el = document.createElement("div")
      document.body.appendChild(el)

      const { result } = renderHook(() => createAttributeSignal(el))
      await flushMicrotasks()

      el.setAttribute("style", "color: red")
      await flushMicrotasks()
      expect(result()).toBe(1)

      el.setAttribute("style", "color: blue")
      await flushMicrotasks()
      expect(result()).toBe(2)

      document.body.removeChild(el)
    })

    it("ignores attributes outside the watched list", async () => {
      const el = document.createElement("div")
      document.body.appendChild(el)

      const { result } = renderHook(() => createAttributeSignal(el, ["class"]))
      await flushMicrotasks()

      // Not in watch list — should be ignored.
      el.setAttribute("data-state", "open")
      await flushMicrotasks()
      expect(result()).toBe(0)

      // In watch list — should fire.
      el.setAttribute("class", "active")
      await flushMicrotasks()
      expect(result()).toBe(1)

      document.body.removeChild(el)
    })

    it("watches a custom attribute list", async () => {
      const el = document.createElement("dialog")
      document.body.appendChild(el)

      const { result } = renderHook(() => createAttributeSignal(el, ["open"]))
      await flushMicrotasks()

      el.setAttribute("open", "")
      await flushMicrotasks()
      expect(result()).toBe(1)

      document.body.removeChild(el)
    })
  })

  describe("reactive ref via accessor", () => {
    it("attaches observer once the ref accessor returns a non-null element", async () => {
      const el = document.createElement("div")
      document.body.appendChild(el)

      const [getEl, setEl] = createSignal<Element | null>(null)
      const { result } = renderHook(() => createAttributeSignal(getEl))
      await flushMicrotasks()

      // Mutation before ref is set — ignored (no observer yet).
      el.setAttribute("class", "early")
      await flushMicrotasks()
      expect(result()).toBe(0)

      // Set ref; effect re-runs; observer attaches.
      setEl(el)
      await flushMicrotasks()

      // Mutation after ref is set — fires.
      el.setAttribute("class", "after")
      await flushMicrotasks()
      expect(result()).toBe(1)

      document.body.removeChild(el)
    })

    it("re-attaches observer when the ref accessor returns a new element", async () => {
      const elA = document.createElement("div")
      const elB = document.createElement("div")
      document.body.appendChild(elA)
      document.body.appendChild(elB)

      const [getEl, setEl] = createSignal<Element | null>(elA)
      const { result } = renderHook(() => createAttributeSignal(getEl))
      await flushMicrotasks()

      elA.setAttribute("class", "a1")
      await flushMicrotasks()
      expect(result()).toBe(1)

      // Swap to elB.
      setEl(elB)
      await flushMicrotasks()

      // Mutation on the OLD element — should NOT fire (observer
      // disconnected via onCleanup when the effect re-ran).
      elA.setAttribute("class", "a2")
      await flushMicrotasks()
      expect(result()).toBe(1)

      // Mutation on the NEW element — fires.
      elB.setAttribute("class", "b1")
      await flushMicrotasks()
      expect(result()).toBe(2)

      document.body.removeChild(elA)
      document.body.removeChild(elB)
    })

    it("disconnects observer when ref becomes null", async () => {
      const el = document.createElement("div")
      document.body.appendChild(el)

      const [getEl, setEl] = createSignal<Element | null>(el)
      const { result } = renderHook(() => createAttributeSignal(getEl))
      await flushMicrotasks()

      el.setAttribute("class", "a1")
      await flushMicrotasks()
      expect(result()).toBe(1)

      // Detach.
      setEl(null)
      await flushMicrotasks()

      // Mutation while ref is null — ignored.
      el.setAttribute("class", "a2")
      await flushMicrotasks()
      expect(result()).toBe(1)

      document.body.removeChild(el)
    })
  })

  describe("edge cases", () => {
    it("empty attrs array is a no-op (no observer created)", async () => {
      const el = document.createElement("div")
      document.body.appendChild(el)

      const { result } = renderHook(() => createAttributeSignal(el, []))
      await flushMicrotasks()

      el.setAttribute("class", "anything")
      await flushMicrotasks()
      expect(result()).toBe(0)

      document.body.removeChild(el)
    })

    it("undefined ref yields a constant signal at 0", async () => {
      const { result } = renderHook(() => createAttributeSignal(undefined))
      await flushMicrotasks()
      expect(result()).toBe(0)
    })

    it("null ref yields a constant signal at 0", async () => {
      const { result } = renderHook(() => createAttributeSignal(null))
      await flushMicrotasks()
      expect(result()).toBe(0)
    })

    it("disposes the observer on owner cleanup", async () => {
      const el = document.createElement("div")
      document.body.appendChild(el)

      const { result, cleanup } = renderHook(() => createAttributeSignal(el))
      await flushMicrotasks()

      el.setAttribute("class", "a1")
      await flushMicrotasks()
      expect(result()).toBe(1)

      cleanup()

      // After cleanup, further mutations don't move the (already
      // disposed) signal. The signal value just doesn't change.
      el.setAttribute("class", "a2")
      await flushMicrotasks()
      expect(result()).toBe(1)

      document.body.removeChild(el)
    })
  })
})
