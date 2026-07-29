import { useCallback, useSyncExternalStore } from 'react'
import type { SectionKey } from './sections.ts'

const STORAGE_PREFIX = 'girovest.tour.v1.'

function storageKey(section: SectionKey) {
  return `${STORAGE_PREFIX}${section}`
}

function readSeen(section: SectionKey): boolean {
  // localStorage access throws in partitioned/sandboxed storage contexts;
  // treat that the same as "not seen yet".
  try {
    return localStorage.getItem(storageKey(section)) === '1'
  } catch {
    return false
  }
}

function persistSeen(section: SectionKey) {
  try {
    localStorage.setItem(storageKey(section), '1')
  } catch {
    // Unavailable storage only loses persistence, not the in-session state.
  }
}

// Module-level cache mirrors useTheme's shared store: every useTourState()
// consumer must agree on which sections have already been seen.
const seenCache = new Map<SectionKey, boolean>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify() {
  for (const listener of listeners) listener()
}

export function hasSeenTour(section: SectionKey): boolean {
  if (!seenCache.has(section)) {
    seenCache.set(section, readSeen(section))
  }
  return seenCache.get(section)!
}

export function markTourSeen(section: SectionKey): void {
  seenCache.set(section, true)
  persistSeen(section)
  notify()
}

export function useTourState(section: SectionKey) {
  const hasSeen = useSyncExternalStore(subscribe, () => hasSeenTour(section))
  // Stable across renders so effects/callbacks that depend on it (e.g.
  // useSectionTour's mount effect) don't re-fire every render.
  const markSeen = useCallback(() => markTourSeen(section), [section])
  return { hasSeen, markSeen }
}
