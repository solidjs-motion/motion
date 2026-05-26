import "@testing-library/jest-dom/vitest"

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
  root = null
  rootMargin = ""
  thresholds = []
}

;(
  globalThis as unknown as { IntersectionObserver: typeof IntersectionObserver }
).IntersectionObserver ??= MockIntersectionObserver as unknown as typeof IntersectionObserver

// jsdom doesn't ship a ResizeObserver. Default-to-noop here so tests
// that don't exercise layout's RO trigger don't crash; layout tests
// that DO need to invoke the callback override via `vi.stubGlobal`.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

;(globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver ??=
  MockResizeObserver as unknown as typeof ResizeObserver
