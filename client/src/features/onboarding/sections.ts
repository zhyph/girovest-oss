// The sections covered by the guided walkthrough. Calendar, Setup and Auth
// stay out of scope: the first is read-only browsing of things the other
// screens create, and the last two are seen once, with their own guidance on
// the page. Configurações earned a place when it went from one column of
// blocks to five navigable sections — the split is the thing that needs
// explaining, since everything else in there is now behind it.
export const TOUR_SECTIONS = ['dashboard', 'clients', 'products', 'contracts', 'settings'] as const

export type SectionKey = (typeof TOUR_SECTIONS)[number]
