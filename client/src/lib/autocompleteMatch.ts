/**
 * Case- and accent-insensitive key for matching and deduplicating free-solo
 * autocomplete values: "festa" must match "Festa" and "cerimonia" must match
 * "Cerimônia". Internal runs of whitespace are also collapsed so "São  Paulo"
 * (double space) folds the same as "São Paulo".
 */
export function foldForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Snaps a typed value to the casing/accents already on file when it's the
 * same value in every way that matters (case- and accent-insensitively) —
 * otherwise "piedade" and "Piedade" end up as two different literal strings
 * in storage depending only on who typed it, and the suggestion list can
 * never fully dedupe them. Falls back to the (trimmed) typed value when
 * nothing on file matches, since that's genuinely a new value.
 */
export function normalizeToSuggestion(value: string, suggestions: string[]): string {
  const trimmed = value.trim()
  const folded = foldForSearch(trimmed)
  if (!folded) return trimmed
  const match = suggestions.find((suggestion) => foldForSearch(suggestion) === folded)
  return match ?? trimmed
}
