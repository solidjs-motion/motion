import { render } from "@solidjs/testing-library"
import { createRoot } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MotionConfig, useMotionConfig } from "../src/motion-config"
import { usePresenceContext } from "../src/presence-context"
import { createReducedMotion, shouldReduceMotion } from "../src/reduced-motion"
import type { Variants } from "../src/types"
import { effectiveLabels, resolveVariant } from "../src/variants"

// ---------------------------------------------------------------------------
// reduced-motion.ts
// ---------------------------------------------------------------------------

describe("createReducedMotion", () => {
  let mediaState: { matches: boolean; listener?: (e: MediaQueryListEvent) => void }

  beforeEach(() => {
    mediaState = { matches: false }
    // Minimal matchMedia mock — jsdom doesn't provide it by default.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: mediaState.matches,
      media: query,
      addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => {
        mediaState.listener = fn
      },
      removeEventListener: () => {
        mediaState.listener = undefined
      },
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  })

  afterEach(() => {
    delete (window as Partial<Window>).matchMedia
  })

  it("returns an Accessor<boolean>", () => {
    createRoot((dispose) => {
      const reduced = createReducedMotion()
      expect(typeof reduced).toBe("function")
      expect(reduced()).toBe(false)
      dispose()
    })
  })

  it("seeds with the current matchMedia state", () => {
    mediaState.matches = true
    createRoot((dispose) => {
      const reduced = createReducedMotion()
      expect(reduced()).toBe(true)
      dispose()
    })
  })

  it("updates when matchMedia fires 'change'", () => {
    createRoot((dispose) => {
      const reduced = createReducedMotion()
      expect(reduced()).toBe(false)
      mediaState.listener?.({ matches: true } as MediaQueryListEvent)
      expect(reduced()).toBe(true)
      mediaState.listener?.({ matches: false } as MediaQueryListEvent)
      expect(reduced()).toBe(false)
      dispose()
    })
  })

  it("removes the listener on owner disposal", () => {
    const { dispose } = createRoot((dispose) => {
      createReducedMotion()
      return { dispose }
    })
    expect(mediaState.listener).toBeDefined()
    dispose()
    expect(mediaState.listener).toBeUndefined()
  })

  it("returns a constant false accessor server-side (no matchMedia)", () => {
    delete (window as Partial<Window>).matchMedia
    createRoot((dispose) => {
      const reduced = createReducedMotion()
      expect(reduced()).toBe(false)
      dispose()
    })
  })
})

describe("shouldReduceMotion", () => {
  it("always returns true for 'always'", () => {
    expect(shouldReduceMotion("always", false)).toBe(true)
    expect(shouldReduceMotion("always", true)).toBe(true)
  })

  it("always returns false for 'never'", () => {
    expect(shouldReduceMotion("never", false)).toBe(false)
    expect(shouldReduceMotion("never", true)).toBe(false)
  })

  it("respects system preference for 'user'", () => {
    expect(shouldReduceMotion("user", false)).toBe(false)
    expect(shouldReduceMotion("user", true)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// variants.ts
// ---------------------------------------------------------------------------

describe("resolveVariant", () => {
  const variants: Variants = {
    visible: { opacity: 1, x: 0 },
    hidden: { opacity: 0, x: 100 },
    highlighted: { scale: 1.2 },
  }

  it("returns null when name is undefined", () => {
    expect(resolveVariant(undefined, variants, undefined)).toBeNull()
  })

  it("returns null when variants is undefined (no cascade per Q4 sub-1B)", () => {
    expect(resolveVariant("visible", undefined, undefined)).toBeNull()
  })

  it("returns null for unknown variant names", () => {
    expect(resolveVariant("does-not-exist", variants, undefined)).toBeNull()
  })

  it("resolves a single string name", () => {
    expect(resolveVariant("visible", variants, undefined)).toEqual({ opacity: 1, x: 0 })
  })

  it("merges an array of names, later wins on conflicts", () => {
    expect(resolveVariant(["visible", "highlighted"], variants, undefined)).toEqual({
      opacity: 1,
      x: 0,
      scale: 1.2,
    })
    expect(resolveVariant(["highlighted", "visible"], variants, undefined)).toEqual({
      scale: 1.2,
      opacity: 1,
      x: 0,
    })
  })

  it("invokes function variants with the custom prop", () => {
    const fnVariants: Variants = {
      visible: (i) => ({ x: (i as number) * 10, opacity: 1 }),
    }
    expect(resolveVariant("visible", fnVariants, 3)).toEqual({ x: 30, opacity: 1 })
  })

  it("returns a fresh object (does not mutate input)", () => {
    const local: Variants = { visible: { opacity: 1 } }
    const result = resolveVariant("visible", local, undefined)
    expect(result).not.toBe(local.visible)
  })
})

describe("effectiveLabels", () => {
  it("returns own value when provided", () => {
    expect(effectiveLabels("visible", "hidden")).toBe("visible")
  })

  it("falls back to parent when own is undefined", () => {
    expect(effectiveLabels(undefined, "hidden")).toBe("hidden")
  })

  it("returns undefined when both are missing", () => {
    expect(effectiveLabels(undefined, undefined)).toBeUndefined()
  })

  it("preserves explicit Target objects", () => {
    const target = { x: 100 }
    expect(effectiveLabels(target, "hidden")).toBe(target)
  })
})

// ---------------------------------------------------------------------------
// presence-context.ts
// ---------------------------------------------------------------------------

describe("usePresenceContext", () => {
  it("returns no-op default outside any <Presence>", () => {
    createRoot((dispose) => {
      const ctx = usePresenceContext()
      expect(typeof ctx.register).toBe("function")
      expect(typeof ctx.unregister).toBe("function")
      expect(typeof ctx.beforeUnmount).toBe("function")
      // Defaults must not throw.
      expect(() => ctx.register(document.createElement("div"), { x: 0 })).not.toThrow()
      expect(() => ctx.unregister(document.createElement("div"))).not.toThrow()
      expect(ctx.beforeUnmount(document.createElement("div"))).resolves.toBeUndefined()
      dispose()
    })
  })
})

// ---------------------------------------------------------------------------
// motion-config.tsx
// ---------------------------------------------------------------------------

describe("MotionConfig", () => {
  it("provides default values when no parent <MotionConfig>", () => {
    createRoot((dispose) => {
      const config = useMotionConfig()
      expect(config.reducedMotion()).toBe("never")
      expect(config.transition()).toBeUndefined()
      expect(config.nonce()).toBeUndefined()
      dispose()
    })
  })

  it("flows reducedMotion to descendants", () => {
    let captured: ReturnType<typeof useMotionConfig> | undefined
    const Inner = () => {
      captured = useMotionConfig()
      return <div />
    }
    render(() => (
      <MotionConfig reducedMotion="always">
        <Inner />
      </MotionConfig>
    ))
    expect(captured?.reducedMotion()).toBe("always")
  })

  it("flows transition default to descendants", () => {
    let captured: ReturnType<typeof useMotionConfig> | undefined
    const Inner = () => {
      captured = useMotionConfig()
      return <div />
    }
    render(() => (
      <MotionConfig transition={{ duration: 0.7 }}>
        <Inner />
      </MotionConfig>
    ))
    expect(captured?.transition()).toEqual({ duration: 0.7 })
  })

  it("flows nonce to descendants", () => {
    let captured: ReturnType<typeof useMotionConfig> | undefined
    const Inner = () => {
      captured = useMotionConfig()
      return <div />
    }
    render(() => (
      <MotionConfig nonce="abc123">
        <Inner />
      </MotionConfig>
    ))
    expect(captured?.nonce()).toBe("abc123")
  })
})
