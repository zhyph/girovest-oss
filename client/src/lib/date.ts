/**
 * Server dates for calendar-day fields (checkout/due/return) are date-only
 * values serialized as UTC midnight ISO strings. `new Date(iso)` parses that
 * as an instant, so any timezone behind UTC (all of Brazil) rolls the
 * displayed day back by one. Reading the Y/M/D components directly and
 * building a local Date keeps the calendar day intact regardless of the
 * runtime's offset from UTC.
 */
export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * The inverse of parseDateOnly: reads the LOCAL calendar components so a day
 * chosen in the calendar keeps its date. `toISOString()` would convert to UTC
 * first and hand back the previous day for anyone behind UTC.
 */
export function toIsoDateOnly(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * The "now" every overdue question is asked as of: start of today, local.
 *
 * Shared by Contratos and Calendário so the two screens cannot disagree about
 * what counts as late. It is the coarsest value that still agrees with the
 * badge `contractState` draws beside each row: it lands after today's
 * UTC-midnight due dates (so a piece due today reads as late, exactly as the
 * badge says) and before tomorrow's, for the UTC-3 locale this app ships.
 *
 * END of today is the wrong end of the day and was the bug: at UTC-3 that
 * instant is tomorrow 02:59 UTC, which is past tomorrow's UTC-midnight due
 * dates, so the Calendário painted a piece due TOMORROW red today. Sending the
 * raw instant instead of a whole day would also mint a new query key on every
 * render.
 */
export function overdueAsOf(): Date {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  return startOfToday
}

export function formatDate(date: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options).format(date)
}

/**
 * A regex-shaped YYYY-MM-DD string isn't necessarily a real calendar day —
 * `new Date(2026, 1, 31)` silently rolls over to March 3rd rather than
 * throwing, so the only reliable check is constructing the date and
 * confirming its components round-trip unchanged.
 */
export function isValidIsoDate(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}
