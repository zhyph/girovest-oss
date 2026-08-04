import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import { toIsoDateOnly } from '../../lib/date.ts'
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
 * on arrival. End of today, matching the Painel's own overdue tile, so the
 * two screens cannot disagree about what counts as late.
 */
function overdueAsOf(): Date {
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)
  return endOfToday
}

export function useCalendarTab(tab: CalendarTab, from: Date, to: Date) {
  const fromIso = from.toISOString()
  const toIso = to.toISOString()

  return useQuery({
    // The overdue set no longer depends on the visible month, so it is keyed
    // by the calendar day instead — keying it by `overdueAsOf()` would mint a
    // new key every render and never serve a cache hit.
    queryKey:
      tab === 'overdue' ? ['calendar', tab, toIsoDateOnly(new Date())] : ['calendar', tab, fromIso, toIso],
    queryFn: () => {
      if (tab === 'overdue') {
        return apiFetch<Allocation[]>(`/api/calendar/overdue?asOf=${overdueAsOf().toISOString()}`)
      }
      return apiFetch<Allocation[]>(`/api/calendar/${tab}?from=${fromIso}&to=${toIso}`)
    },
  })
}
