import type { SectionKey } from './sections.ts'

export type TourStep = {
  // Suffixed onto the section key to form the `data-tour="<section>.<anchor>"`
  // selector and the `tour:<section>.steps.<anchor>.{title,description}` i18n
  // keys — one source of truth for both, no copy duplicated in this file.
  anchor: string
}

export const SECTION_ROUTES: Record<SectionKey, string> = {
  dashboard: '/',
  clients: '/clientes',
  products: '/produtos',
  contracts: '/contratos',
}

// v1 tours are page-level only: every anchor here must be present as soon as
// the page mounts (no walking into drawers/modals), which is what lets
// buildDriverSteps.ts skip a full "wait for element" implementation and just
// check DOM presence once, at tour-start time.
export const TOURS: Record<SectionKey, TourStep[]> = {
  dashboard: [
    { anchor: 'title' },
    { anchor: 'gettingStarted' },
    { anchor: 'stats' },
    { anchor: 'upcoming' },
  ],
  clients: [
    { anchor: 'create' },
    { anchor: 'search' },
    { anchor: 'table' },
  ],
  products: [
    { anchor: 'create' },
    { anchor: 'photoSession' },
    { anchor: 'search' },
    { anchor: 'table' },
  ],
  contracts: [
    { anchor: 'create' },
    { anchor: 'search' },
    { anchor: 'card' },
    { anchor: 'pagination' },
  ],
}

export function tourStepSelector(section: SectionKey, anchor: string): string {
  return `[data-tour="${section}.${anchor}"]`
}
