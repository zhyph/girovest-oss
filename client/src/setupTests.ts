import '@testing-library/jest-dom'

// jsdom has no IntersectionObserver; framer-motion's useInView (used by the
// CountUp dashboard component) needs one to exist. Firing the callback with
// isIntersecting: true as soon as an element is observed simulates it being
// immediately on-screen, which is what every test here actually needs —
// none of them scroll, so "never intersecting" would just show CountUp
// frozen at its starting value instead of the value under test.
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin: string = ''
  readonly scrollMargin: string = ''
  readonly thresholds: ReadonlyArray<number> = []

  constructor(private callback: IntersectionObserverCallback) {}

  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this,
    )
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver
