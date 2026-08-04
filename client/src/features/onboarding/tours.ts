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
  settings: '/configuracoes',
}

// v1 tours are page-level only: every anchor here must be present as soon as
// the page mounts (no walking into drawers/modals), which is what lets
// buildDriverSteps.ts skip a full "wait for element" implementation and just
// check DOM presence once, at tour-start time.
export const TOURS: Record<SectionKey, TourStep[]> = {
  dashboard: [
    // The rail belongs to the app shell rather than to the Painel, but the
    // Painel is where a new user lands, and a walkthrough that starts by
    // explaining a screen without saying how to leave it explains the wrong
    // thing first.
    { anchor: 'rail' },
    { anchor: 'shortcut' },
    { anchor: 'title' },
    { anchor: 'gettingStarted' },
    { anchor: 'stats' },
    { anchor: 'upcoming' },
  ],
  clients: [
    { anchor: 'create' },
    { anchor: 'search' },
    { anchor: 'table' },
    // The master-detail split is the redesign's central move on this screen
    // and on Contratos: the list stopped carrying every field and every
    // action, and both now live in a panel beside it. Nobody guesses that a
    // row is a thing you select rather than a thing you open.
    { anchor: 'detail' },
    { anchor: 'rowActions' },
    { anchor: 'pagination' },
  ],
  products: [
    { anchor: 'create' },
    { anchor: 'photoSession' },
    { anchor: 'search' },
    { anchor: 'filters' },
    { anchor: 'views' },
    { anchor: 'table' },
  ],
  contracts: [
    { anchor: 'create' },
    { anchor: 'search' },
    { anchor: 'filters' },
    { anchor: 'card' },
    { anchor: 'detail' },
    { anchor: 'pagination' },
  ],
  settings: [{ anchor: 'sections' }],
}

export function tourStepSelector(section: SectionKey, anchor: string): string {
  return `[data-tour="${section}.${anchor}"]`
}
