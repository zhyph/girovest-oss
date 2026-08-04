import { describe, it, expect, afterEach } from 'vitest'
import { parseDateOnly, formatDate, isValidIsoDate, overdueAsOf } from './date.ts'

describe('overdueAsOf', () => {
  const originalTz = process.env.TZ
  afterEach(() => {
    process.env.TZ = originalTz
  })

  /** What the server does with the value: `dueDate: { lt: asOf }`. */
  function readsAsOverdue(dueDateIso: string): boolean {
    return new Date(dueDateIso).getTime() < overdueAsOf().getTime()
  }

  it('CRITICAL: a piece due today is late, a piece due tomorrow is not', () => {
    // Pinned to the locale this app ships in, so the assertion means the same
    // thing on a UTC CI runner as it does on a shop machine.
    process.env.TZ = 'America/Sao_Paulo'
    // Due dates are date-only values the server stores at UTC midnight.
    const today = new Date()
    const utcMidnight = (dayOffset: number) =>
      new Date(
        Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset),
      ).toISOString()

    expect(readsAsOverdue(utcMidnight(-1))).toBe(true)
    expect(readsAsOverdue(utcMidnight(0))).toBe(true)
    // End of today — the value the Calendário used to send — is tomorrow
    // 02:59 UTC here, which swallows tomorrow's due dates and paints them red
    // a day early.
    expect(readsAsOverdue(utcMidnight(1))).toBe(false)
  })
})

describe('parseDateOnly', () => {
  it('keeps the calendar day intact regardless of the UTC suffix', () => {
    const date = parseDateOnly('2026-07-23T00:00:00.000Z')
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(6)
    expect(date.getDate()).toBe(23)
  })

  it('parses a bare YYYY-MM-DD string the same way', () => {
    const date = parseDateOnly('2026-01-05')
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(0)
    expect(date.getDate()).toBe(5)
  })
})

describe('formatDate', () => {
  it('formats a date using the given locale and options', () => {
    const date = new Date(2026, 7, 23)
    expect(formatDate(date, 'pt-BR', { day: '2-digit', month: '2-digit' })).toBe('23/08')
  })

  it('includes the year when asked', () => {
    const date = new Date(2026, 7, 23)
    expect(formatDate(date, 'pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })).toBe('23/08/2026')
  })
})

describe('isValidIsoDate', () => {
  it('accepts a real calendar date', () => {
    expect(isValidIsoDate('2026-07-23')).toBe(true)
  })

  it('accepts February 29th on a leap year', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true)
  })

  it('rejects February 29th on a non-leap year', () => {
    expect(isValidIsoDate('2026-02-29')).toBe(false)
  })

  it('rejects a day that does not exist in the given month', () => {
    expect(isValidIsoDate('2026-02-31')).toBe(false)
    expect(isValidIsoDate('2026-04-31')).toBe(false)
  })

  it('rejects a month greater than 12', () => {
    expect(isValidIsoDate('2026-13-01')).toBe(false)
  })

  it('rejects malformed or non-ISO input', () => {
    expect(isValidIsoDate('')).toBe(false)
    expect(isValidIsoDate('not-a-date')).toBe(false)
    expect(isValidIsoDate('2026/07/23')).toBe(false)
    expect(isValidIsoDate('23-07-2026')).toBe(false)
    expect(isValidIsoDate('2026-7-23')).toBe(false)
  })
})
