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

export function formatDate(date: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options).format(date)
}
