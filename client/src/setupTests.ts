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

// jsdom has no layout engine, so `document.elementFromPoint` doesn't exist.
// react-big-calendar's month grid (now CalendarPage's default view) reaches
// for it as soon as it mounts, to wire up its drag-to-select handling —
// unrelated to what any test here actually exercises, so returning null is
// enough to keep it from throwing.
if (!document.elementFromPoint) {
  document.elementFromPoint = () => null
}

// jsdom doesn't implement matchMedia. Sidebar calls it unconditionally (to
// close the mobile drawer on a breakpoint crossing), so every test that
// renders it needs at least a no-op stub; tests that care about the actual
// 'change' behavior override this with their own mock.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
