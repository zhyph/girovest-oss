import { foldForSearch } from '../../lib/autocompleteMatch.ts'
import type { Product } from './productSchemas.ts'

/** The two free-text fields a shop actually narrows its catalogue by. */
export type ProductFacet = 'category' | 'size'

export const PRODUCT_FACETS: readonly ProductFacet[] = ['category', 'size']

/**
 * Selected values are stored folded (see `foldForSearch`), never as typed.
 * The catalogue is free-text, so the same category reaches this screen as
 * "Festa" on one piece and "festa" on another; keying on the folded form is
 * what makes one menu entry select both.
 */
export type ProductFacetSelection = Record<ProductFacet, string[]>

export const EMPTY_FACET_SELECTION: ProductFacetSelection = { category: [], size: [] }

export type FacetOption = {
  /** Folded value, and the identity used by the selection. */
  key: string
  /** The spelling to show, taken from the catalogue rather than invented. */
  label: string
}

/**
 * The conventional letter ladder. Neither alphabetical nor numeric ordering
 * produces it (alphabetically P sorts after GG), and a shop reads its rack in
 * this order. This only ranks labels for display: it never decides which
 * options exist, so a shop using sizes outside the ladder still sees all of
 * its own, ordered by the numeric/alphabetical fallback below.
 */
const SIZE_LADDER = ['pp', 'p', 'm', 'g', 'gg', 'xg', 'xgg']

function numericSize(key: string): number | null {
  // Only a bare number counts. "38" is a size; "38 curto" is a label whose
  // ordering we have no business guessing.
  if (!/^\d+$/.test(key)) return null
  return Number(key)
}

function compareSizes(a: FacetOption, b: FacetOption, locale: string): number {
  const numericA = numericSize(a.key)
  const numericB = numericSize(b.key)
  if (numericA !== null && numericB !== null) return numericA - numericB
  // Numeric sizes lead: they are the primary system for dresses, and letter
  // sizes read as a secondary grouping under them.
  if (numericA !== null) return -1
  if (numericB !== null) return 1

  const rankA = SIZE_LADDER.indexOf(a.key)
  const rankB = SIZE_LADDER.indexOf(b.key)
  if (rankA !== -1 && rankB !== -1) return rankA - rankB
  if (rankA !== -1) return -1
  if (rankB !== -1) return 1

  return a.label.localeCompare(b.label, locale)
}

/**
 * The options a shop can filter by are whatever it has put in its own
 * catalogue. Nothing here is a fixed list: a shop that only rents ternos
 * never sees a "vestido de festa" entry it cannot use.
 */
export function deriveFacetOptions(
  products: Product[],
  facet: ProductFacet,
  locale: string,
): FacetOption[] {
  const labelByKey = new Map<string, string>()
  for (const product of products) {
    const raw = product[facet]?.trim()
    if (!raw) continue
    const key = foldForSearch(raw)
    if (!key || labelByKey.has(key)) continue
    // First spelling on file wins, the same rule ProductDrawer's autocomplete
    // snaps to, so the menu cannot list "Festa" and "festa" side by side.
    labelByKey.set(key, raw)
  }
  const options = [...labelByKey].map(([key, label]) => ({ key, label }))
  return facet === 'size'
    ? options.sort((a, b) => compareSizes(a, b, locale))
    : options.sort((a, b) => a.label.localeCompare(b.label, locale))
}

/**
 * Within a facet the selected values are alternatives; across facets they
 * accumulate. "Festa or Gala, in size M" is the question a shop asks; "festa
 * and gala on the same piece" is not one it can have an answer to.
 */
export function matchesFacetSelection(product: Product, selection: ProductFacetSelection): boolean {
  return PRODUCT_FACETS.every((facet) => {
    const selected = selection[facet]
    if (selected.length === 0) return true
    return selected.includes(foldForSearch(product[facet] ?? ''))
  })
}

export function countSelectedFacets(selection: ProductFacetSelection): number {
  return PRODUCT_FACETS.reduce((total, facet) => total + selection[facet].length, 0)
}

export function toggleFacetValue(
  selection: ProductFacetSelection,
  facet: ProductFacet,
  key: string,
): ProductFacetSelection {
  const selected = selection[facet]
  return {
    ...selection,
    [facet]: selected.includes(key) ? selected.filter((entry) => entry !== key) : [...selected, key],
  }
}

export const PRODUCT_SORTS = ['recent', 'code', 'name', 'priceDesc', 'priceAsc'] as const

export type ProductSort = (typeof PRODUCT_SORTS)[number]

// `satisfies` rather than a `: ProductSort` annotation: the annotation would
// widen this to the whole union, and the early return below would then stop
// narrowing `sort`, leaving the switch non-exhaustive.
export const DEFAULT_PRODUCT_SORT = 'recent' satisfies ProductSort

export function sortProducts(products: Product[], sort: ProductSort, locale: string): Product[] {
  // The server already returns newest first. Handing that order back untouched
  // rather than re-sorting on createdAt is what guarantees this control cannot
  // reorder the screen for a shop that never opens it, including for pieces
  // that share a timestamp.
  if (sort === DEFAULT_PRODUCT_SORT) return products

  const sorted = [...products]
  switch (sort) {
    case 'code':
      return sorted.sort((a, b) => {
        // A piece with no code predates the field and has not been through the
        // backfill yet, so it has no place in the numeric run and goes last.
        if (a.code === b.code) return 0
        if (a.code === null) return 1
        if (b.code === null) return -1
        return a.code - b.code
      })
    case 'name':
      return sorted.sort((a, b) => a.name.localeCompare(b.name, locale))
    case 'priceDesc':
      return sorted.sort((a, b) => b.rentalPrice - a.rentalPrice)
    case 'priceAsc':
      return sorted.sort((a, b) => a.rentalPrice - b.rentalPrice)
  }
}
