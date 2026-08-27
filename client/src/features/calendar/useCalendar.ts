import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import { overdueAsOf, toIsoDateOnly } from '../../lib/date.ts'
import type { Allocation } from '../allocations/allocationSchemas.ts'

export type CalendarTab = 'going-out' | 'due-back' | 'overdue'

/**
 * "Atrasado" means late right now, so it is asked as of today rather than as
 * of whichever month happens to be on screen.
 *
 * This used to pass the visible month's end, which brought back every piece
 * merely due later that month as overdue. It was survivable while Atrasados
 * was a tab you had to pick deliberately; once the grid started showing all
 * three sets together by default, it painted a dress due next Thursday red
 * on arrival. The replacement then used the END of today, which at UTC-3 is
 * past tomorrow's UTC-midnight due dates and painted anything due TOMORROW
 * red as well — so the shared `overdueAsOf` Contratos already uses is what
 * both screens ask with now.
 */

/**
 * The overdue query, defined once so the Calendário and the Painel cannot ask
 * it differently — they used to, and answered the same shop two different
 * numbers on the same morning. Sharing the key also means both screens read
 * one cache entry rather than each holding its own.
 *
 * Keyed by the calendar day, not by `overdueAsOf()` itself, which would mint a
 * new key every render and never serve a cache hit.
 */
export function overdueQueryKey() {
  return ['calendar', 'overdue', toIsoDateOnly(new Date())]
}

export function fetchOverdue() {
  return apiFetch<Allocation[]>(`/api/calendar/overdue?asOf=${overdueAsOf().toISOString()}`)
}

/**
 * Bounds go over the wire as plain YYYY-MM-DD, never as `Date.toISOString()`.
 *
 * checkoutDate/dueDate are date-only values stored at UTC midnight, and the
 * route coerces a bare date string to that same UTC midnight — so date-only in
 * means the comparison happens between like and like. A local-constructed
 * instant does not: at UTC-3, local midnight on the 1st serializes as
 * `T03:00:00Z`, which sorts AFTER the 1st's own stored `T00:00:00Z`, so `gte`
 * dropped the first day of every range and picked up the day after the last
 * one instead. That is what hid the 1st of the month from the grid.
 */
export function useCalendarTab(tab: CalendarTab, from: Date, to: Date) {
  const fromIso = toIsoDateOnly(from)
  const toIso = toIsoDateOnly(to)

  return useQuery({
    queryKey: tab === 'overdue' ? overdueQueryKey() : ['calendar', tab, fromIso, toIso],
    queryFn: () => {
      if (tab === 'overdue') return fetchOverdue()
      return apiFetch<Allocation[]>(`/api/calendar/${tab}?from=${fromIso}&to=${toIso}`)
    },
  })
}
