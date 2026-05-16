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
