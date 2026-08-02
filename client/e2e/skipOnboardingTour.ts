import type { Page } from '@playwright/test'

// Every seeded e2e account is "fresh", so the guided walkthrough (driver.js)
// auto-starts on first visit to each of these sections and its overlay
// intercepts clicks on nav links/buttons underneath it — unrelated specs
// then fail on an unrelated click timeout. Mark all sections as already
// seen before the app's own JS ever checks, so the tour never mounts.
// Keep in sync with client/src/features/onboarding/sections.ts's TOUR_SECTIONS.
const TOUR_SECTIONS = ['dashboard', 'clients', 'products', 'contracts']

export async function skipOnboardingTour(page: Page): Promise<void> {
  await page.addInitScript((sections: string[]) => {
    for (const section of sections) {
      window.localStorage.setItem(`girovest.tour.v1.${section}`, '1')
    }
  }, TOUR_SECTIONS)
}
