import type { SectionKey } from './sections.ts'

// The Settings page's "Rever" button navigates to the section's own route
// (an in-app SPA transition, no reload) and needs to tell that page to start
// its tour once it mounts — regardless of whether the section was already
// seen. A plain module-level value survives the transition without needing
// localStorage, and consuming it clears it so it only fires once.
let pendingSection: SectionKey | null = null

export function requestTourReplay(section: SectionKey): void {
  pendingSection = section
}

export function consumePendingReplay(section: SectionKey): boolean {
  if (pendingSection !== section) return false
  pendingSection = null
  return true
}
