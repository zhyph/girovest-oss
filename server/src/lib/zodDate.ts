import { z } from 'zod'

/**
 * `z.coerce.date()` accepts any string `new Date()` can parse, including a
 * day that doesn't exist on the calendar — `new Date('2026-02-31')` silently
 * rolls over to March instead of failing. Allocation and contract dates
 * drive the whole app's scheduling, so a mistyped date must be rejected
 * outright rather than quietly shifted to a different day.
 *
 * The format itself is the contract: a strict, zero-padded YYYY-MM-DD date,
 * optionally followed by a strict ISO 8601 time component — "T" separator,
 * HH:MM, optional :SS, optional fractional seconds, optional "Z" or ±HH:MM
 * offset. Anything that doesn't match — non-padded digits ("2026-2-31"),
 * slash-separated dates, natural-language dates, bare numeric timestamps,
 * space-separated datetimes ("2026-02-10 14:30", ambiguous local time),
 * or a malformed time suffix ("2026-02-10Tgarbage") — is rejected outright
 * rather than handed to a permissive fallback parser, which is exactly how
 * the bug this replaces let malformed input back in (every one of those
 * forms round-trips through `new Date()` without throwing, several of them
 * by rolling over to a different day or producing an Invalid Date). This is
 * deliberately narrower than `z.coerce.date()`, which also accepted numeric
 * epoch timestamps — nothing in this codebase sends those.
 */
const STRICT_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/

export const isoDate = z
  .string()
  .refine((value) => {
    if (!STRICT_DATE_PATTERN.test(value)) return false
    const year = Number(value.slice(0, 4))
    const month = Number(value.slice(5, 7))
    const day = Number(value.slice(8, 10))
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return false
    }
    // Belt and braces: a shape-valid string can still carry an out-of-range
    // time ("2026-02-10T25:99") that parses to an Invalid Date. Reject it
    // here so NaN never flows into Prisma writes or overlap comparisons.
    return !Number.isNaN(new Date(value).getTime())
  }, { message: 'Invalid date' })
  .transform((value) => new Date(value))
