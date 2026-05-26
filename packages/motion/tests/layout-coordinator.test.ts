import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createLayoutCoordinator } from "../src/layout-coordinator"
import type { LayoutEntry } from "../src/types"

// ---------------------------------------------------------------------------
// RAF stubbing — collects scheduled callbacks into a queue; tests call
// `flushRAF()` to advance one RAF tick deterministically. Restored
// between tests via beforeEach/afterEach.
// ---------------------------------------------------------------------------

let rafCallbacks: FrameRequestCallback[]

function flushRAF(): void {
  const callbacks = rafCallbacks
  rafCallbacks = []
  for (const cb of callbacks) cb(performance.now())
}

beforeEach(() => {
  rafCallbacks = []
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Synthetic LayoutEntry — the actual `el` doesn't need to be in the DOM
// for the coordinator's own tests; we just need a stand-in.
// ---------------------------------------------------------------------------

function makeEntry(label = ""): LayoutEntry {
  const el = document.createElement("div")
  el.setAttribute("data-test", label)
  return {
    el,
    rect: new DOMRect(0, 0, 100, 100),
    projectionParentRect: new DOMRect(0, 0, 1000, 1000),
  }
}

describe("LayoutCoordinator", () => {
  describe("donate / consume — same tick", () => {
    it("donate then consume returns the entry", () => {
      const c = createLayoutCoordinator()
      const entry = makeEntry("a")
      c.donate("x", entry)
      expect(c.consume("x")).toBe(entry)
    })

    it("consume without prior donate returns null", () => {
      const c = createLayoutCoordinator()
      expect(c.consume("x")).toBeNull()
    })

    it("consume removes the entry — second consume returns null", () => {
      const c = createLayoutCoordinator()
      c.donate("x", makeEntry())
      expect(c.consume("x")).not.toBeNull()
      expect(c.consume("x")).toBeNull()
    })

    it("donate twice with the same id — second overwrites first", () => {
      const c = createLayoutCoordinator()
      const first = makeEntry("first")
      const second = makeEntry("second")
      c.donate("x", first)
      c.donate("x", second)
      expect(c.consume("x")).toBe(second)
    })

    it("isolates entries by layoutId — independent ids don't interfere", () => {
      const c = createLayoutCoordinator()
      const a = makeEntry("a")
      const b = makeEntry("b")
      c.donate("a", a)
      c.donate("b", b)
      expect(c.consume("a")).toBe(a)
      expect(c.consume("b")).toBe(b)
    })
  })

  describe("RAF cleanup — entry expiration", () => {
    it("entry donated and consumed within the same RAF window succeeds", () => {
      const c = createLayoutCoordinator()
      const entry = makeEntry()
      c.donate("x", entry)
      // No RAF tick has elapsed yet.
      expect(c.consume("x")).toBe(entry)
    })

    it("entry survives until the first full RAF tick", () => {
      const c = createLayoutCoordinator()
      const entry = makeEntry()
      c.donate("x", entry)
      flushRAF()
      // First RAF fires; entry was marked stale on donate and is now
      // dropped. Consume should return null.
      expect(c.consume("x")).toBeNull()
    })

    it("entry donated AFTER the first RAF was scheduled survives that RAF", () => {
      const c = createLayoutCoordinator()
      // First donate schedules cleanup, marks "x" stale.
      c.donate("x", makeEntry("x"))
      // Second donate happens within the same RAF window — NOT marked stale.
      const yEntry = makeEntry("y")
      c.donate("y", yEntry)

      flushRAF()
      // x was stale → dropped. y was not stale → still there.
      // (Eventual expiration of y at the NEXT RAF is covered by the
      // auto-reschedule test below.)
      expect(c.consume("y")).toBe(yEntry)
    })

    it("auto-reschedules cleanup if entries remain after a RAF tick (no leak)", () => {
      const c = createLayoutCoordinator()
      // Donate inside scheduleCleanup's window with a second donate that
      // arrives AFTER the first one's marking pass.
      c.donate("x", makeEntry()) // schedules cleanup, marks x stale
      c.donate("y", makeEntry()) // not marked

      flushRAF() // RAF 1: drops x; y remains; auto-reschedules cleanup
      flushRAF() // RAF 2: drops y

      expect(c.consume("y")).toBeNull()
    })

    it("consume during the stale window removes the entry without leaking it into staleKeys delete-pass", () => {
      const c = createLayoutCoordinator()
      const entry = makeEntry()
      c.donate("x", entry)
      // Consume removes the entry AND clears its stale-key marker.
      expect(c.consume("x")).toBe(entry)
      // RAF fires — should not throw, should not affect anything else.
      expect(() => flushRAF()).not.toThrow()
    })

    it("re-donate after expiration starts a fresh lifetime window", () => {
      const c = createLayoutCoordinator()
      c.donate("x", makeEntry("first"))
      flushRAF()
      // First entry expired.
      expect(c.consume("x")).toBeNull()
      // Donate again — should be available.
      const second = makeEntry("second")
      c.donate("x", second)
      expect(c.consume("x")).toBe(second)
    })
  })

  describe("multiple coordinator instances are independent", () => {
    it("a LayoutGroup-scoped coordinator does not see root coordinator entries", () => {
      const a = createLayoutCoordinator()
      const b = createLayoutCoordinator()
      const entry = makeEntry()
      a.donate("x", entry)
      // b is a separate instance — should not find entry deposited in a.
      expect(b.consume("x")).toBeNull()
      // a still has it.
      expect(a.consume("x")).toBe(entry)
    })
  })
})
