import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import { toIsoDateOnly } from '../../lib/date.ts'
import { fetchOverdue, overdueQueryKey } from '../calendar/useCalendar.ts'
import { useOutstanding } from '../contracts/useContracts.ts'

export interface AllocationSummary {
  id: string
  productId: string
  clientId: string
  checkoutDate: string
  dueDate: string
  status: string
}

export interface LeavingMaintenanceItem {
  id: string
  name: string
  /** First day the piece can go out again — the day after its cleaning ends. */
  availableOn: string
}

export interface LeavingMaintenanceSummary {
  count: number
  items: LeavingMaintenanceItem[]
}

const EMPTY_OUTSTANDING = { total: 0, count: 0 }
const EMPTY_LEAVING_MAINTENANCE: LeavingMaintenanceSummary = { count: 0, items: [] }

/** How far ahead "Próximas saídas" looks, in days. */
const UPCOMING_WINDOW_DAYS = 7

function daysFromToday(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

export function useDashboard() {
  /*
   * Date-only bounds, for the reason spelled out on useCalendarTab: the
   * calendar-day columns are stored at UTC midnight, and a local-midnight
   * instant sent as `toISOString()` lands at T03:00:00Z here, an hour range
   * that starts AFTER today's own rows and ends inside tomorrow's. The Painel
   * was reading a whole day late — "Saindo hoje" listed tomorrow's pieces and
   * hid today's, on the one screen the shop plans the morning from.
   */
  const from = toIsoDateOnly(new Date())
  const to = from
  // "Próximas saídas" starts TOMORROW, not today. Today's departures have
  // their own tile and their own list right beside it, and the date fix above
  // would otherwise have made the two panels repeat each other verbatim — the
  // old bounds hid that by accidentally starting a day late.
  const upcomingFrom = toIsoDateOnly(daysFromToday(1))
  const upcomingTo = toIsoDateOnly(daysFromToday(UPCOMING_WINDOW_DAYS))

  const goingOut = useQuery({
    queryKey: ['calendar', 'going-out', from, to],
    queryFn: () => apiFetch<AllocationSummary[]>(`/api/calendar/going-out?from=${from}&to=${to}`),
  })
  const dueBack = useQuery({
    queryKey: ['calendar', 'due-back', from, to],
    queryFn: () => apiFetch<AllocationSummary[]>(`/api/calendar/due-back?from=${from}&to=${to}`),
  })
  /*
   * Asked exactly the way the Calendário asks it, through the shared helpers,
   * so the two screens share one cache entry and cannot disagree. Asking as of
   * the END of today was the bug: at UTC-3 that instant is tomorrow 02:59 UTC,
   * past tomorrow's UTC-midnight due dates, so "Atrasados" counted pieces that
   * are not due back until tomorrow and sent the shop chasing them.
   */
  const overdue = useQuery({
    queryKey: overdueQueryKey(),
    queryFn: fetchOverdue,
  })
  const upcoming = useQuery({
    queryKey: ['calendar', 'going-out', upcomingFrom, upcomingTo],
    queryFn: () => apiFetch<AllocationSummary[]>(`/api/calendar/going-out?from=${upcomingFrom}&to=${upcomingTo}`),
  })

  const outstanding = useOutstanding()
  const leavingMaintenance = useQuery({
    queryKey: ['products', 'leaving-maintenance'],
    queryFn: () => apiFetch<LeavingMaintenanceSummary>('/api/products/leaving-maintenance'),
  })

  return {
    goingOutToday: goingOut.data ?? [],
    dueBackToday: dueBack.data ?? [],
    overdue: overdue.data ?? [],
    upcoming: upcoming.data ?? [],
    outstanding: outstanding.data ?? EMPTY_OUTSTANDING,
    leavingMaintenance: leavingMaintenance.data ?? EMPTY_LEAVING_MAINTENANCE,
    isLoading:
      goingOut.isLoading ||
      dueBack.isLoading ||
      overdue.isLoading ||
      upcoming.isLoading ||
      outstanding.isLoading ||
      leavingMaintenance.isLoading,
    /**
     * Refetches every query behind the Painel, so one control can recover the
     * whole screen. Individual retries would be worse than useless here: the
     * screen renders as a single unit and one stale tile among five recovered
     * ones is a figure she cannot tell is stale.
     */
    refetch: () => {
      void goingOut.refetch()
      void dueBack.refetch()
      void overdue.refetch()
      void upcoming.refetch()
      void outstanding.refetch()
      void leavingMaintenance.refetch()
    },
    isError:
      goingOut.isError ||
      dueBack.isError ||
      overdue.isError ||
      upcoming.isError ||
      outstanding.isError ||
      leavingMaintenance.isError,
  }
}
