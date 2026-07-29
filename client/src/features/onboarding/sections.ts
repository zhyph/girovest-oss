// The four sections covered by v1 of the guided walkthrough. Calendar,
// Settings, Setup, and Auth are deliberately out of scope for now.
export const TOUR_SECTIONS = ['dashboard', 'clients', 'products', 'contracts'] as const

export type SectionKey = (typeof TOUR_SECTIONS)[number]
