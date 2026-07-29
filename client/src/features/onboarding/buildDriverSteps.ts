import type { DriveStep } from 'driver.js'
import type { SectionKey } from './sections.ts'
import { TOURS, tourStepSelector } from './tours.ts'

export type TranslateStep = (key: string) => string

// Filters the section's registered steps down to the ones whose anchor is
// actually mounted right now. v1 tours only cover always-on-page-load
// elements (see tours.ts), so a one-time DOM presence check at tour-start
// time is enough — no need to wait/poll for anchors that appear later.
export function buildDriverSteps(section: SectionKey, t: TranslateStep): DriveStep[] {
  return TOURS[section]
    .filter((step) => document.querySelector(tourStepSelector(section, step.anchor)) !== null)
    .map((step) => ({
      element: tourStepSelector(section, step.anchor),
      popover: {
        title: t(`${section}.steps.${step.anchor}.title`),
        description: t(`${section}.steps.${step.anchor}.description`),
      },
    }))
}
