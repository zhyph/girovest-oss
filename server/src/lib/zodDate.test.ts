import { describe, it, expect } from 'vitest'
import { isoDate } from './zodDate.js'

describe('isoDate', () => {
  it('accepts a real calendar date and transforms it to a Date', () => {
    const result = isoDate.safeParse('2026-07-23')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBeInstanceOf(Date)
  })

  it('accepts a date with a time component', () => {
    const result = isoDate.safeParse('2026-07-25T14:30:00.000Z')
    expect(result.success).toBe(true)
  })

  it('accepts reasonable ISO time forms: HH:MM, optional seconds, optional ms, optional Z or offset', () => {
    expect(isoDate.safeParse('2026-02-03').success).toBe(true)
    expect(isoDate.safeParse('2026-02-10T14:30').success).toBe(true)
    expect(isoDate.safeParse('2026-02-10T14:30:00').success).toBe(true)
    expect(isoDate.safeParse('2026-02-10T14:30:00Z').success).toBe(true)
    expect(isoDate.safeParse('2026-02-10T14:30:00.123Z').success).toBe(true)
    expect(isoDate.safeParse('2026-02-10T14:30:00+02:00').success).toBe(true)
    expect(isoDate.safeParse('2026-02-10T14:30:00.500-03:00').success).toBe(true)
  })

  it('accepts February 29th on a leap year', () => {
    expect(isoDate.safeParse('2024-02-29').success).toBe(true)
  })

  it('rejects a day that does not exist on the calendar', () => {
    expect(isoDate.safeParse('2026-02-31').success).toBe(false)
  })

  it('rejects February 29th on a non-leap year', () => {
    expect(isoDate.safeParse('2026-02-29').success).toBe(false)
  })

  // These all round-trip through `new Date()` without throwing — several by
  // silently rolling over to a different day — which is exactly how a
  // permissive fallback parser reopened the bug this schema exists to close.
  it('rejects non-padded, slash-separated, and natural-language dates instead of falling back to a permissive parse', () => {
    expect(isoDate.safeParse('2026-2-31').success).toBe(false)
    expect(isoDate.safeParse('2026-2-30').success).toBe(false)
    expect(isoDate.safeParse('2026/02/31').success).toBe(false)
    expect(isoDate.safeParse(' 2026-02-31').success).toBe(false)
    expect(isoDate.safeParse('February 31, 2026').success).toBe(false)
  })

  it('rejects a bare numeric timestamp, unlike the z.coerce.date() it replaces', () => {
    expect(isoDate.safeParse('1753452600000').success).toBe(false)
  })

  it('rejects malformed or empty input', () => {
    expect(isoDate.safeParse('').success).toBe(false)
    expect(isoDate.safeParse('not-a-date').success).toBe(false)
  })

  // A valid calendar date followed by junk used to slip through the old
  // `(?:[T ].*)?` suffix and transform into an Invalid Date (NaN) that
  // flowed into Prisma writes and allocation-overlap comparisons.
  it('rejects a malformed time suffix instead of transforming to Invalid Date', () => {
    expect(isoDate.safeParse('2026-02-10Tgarbage').success).toBe(false)
    expect(isoDate.safeParse('2026-02-10T').success).toBe(false)
    expect(isoDate.safeParse('2026-02-10T25:99').success).toBe(false)
  })

  // Space-separated datetimes are ambiguous local time (the API contract is
  // ISO 8601 with 'T'); a trailing space made '2026-02-10 ' parse as LOCAL
  // midnight while '2026-02-10' is UTC midnight — a timezone off-by-one.
  it('rejects space-separated datetimes and trailing whitespace', () => {
    expect(isoDate.safeParse('2026-02-10 25:99').success).toBe(false)
    expect(isoDate.safeParse('2026-02-10 14:30').success).toBe(false)
    expect(isoDate.safeParse('2026-02-10 ').success).toBe(false)
  })
})
