import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import type { Allocation } from '../allocations/allocationSchemas.ts'

export type CalendarTab = 'going-out' | 'due-back' | 'overdue'

export function useCalendarTab(tab: CalendarTab, from: Date, to: Date) {
  const fromIso = from.toISOString()
  const toIso = to.toISOString()

  return useQuery({
    queryKey: ['calendar', tab, fromIso, toIso],
    queryFn: () => {
      if (tab === 'overdue') {
        return apiFetch<Allocation[]>(`/api/calendar/overdue?asOf=${toIso}`)
      }
      return apiFetch<Allocation[]>(`/api/calendar/${tab}?from=${fromIso}&to=${toIso}`)
    },
  })
}
