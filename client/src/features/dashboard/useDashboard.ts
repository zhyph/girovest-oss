import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
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

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfToday() {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

function endOfUpcomingWindow() {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  d.setHours(23, 59, 59, 999)
  return d
}

export function useDashboard() {
  const from = startOfToday().toISOString()
  const to = endOfToday().toISOString()
  const upcomingTo = endOfUpcomingWindow().toISOString()

  const goingOut = useQuery({
    queryKey: ['calendar', 'going-out', from, to],
    queryFn: () => apiFetch<AllocationSummary[]>(`/api/calendar/going-out?from=${from}&to=${to}`),
  })
  const dueBack = useQuery({
    queryKey: ['calendar', 'due-back', from, to],
    queryFn: () => apiFetch<AllocationSummary[]>(`/api/calendar/due-back?from=${from}&to=${to}`),
  })
  const overdue = useQuery({
    queryKey: ['calendar', 'overdue', to],
    queryFn: () => apiFetch<AllocationSummary[]>(`/api/calendar/overdue?asOf=${to}`),
  })
  const upcoming = useQuery({
    queryKey: ['calendar', 'going-out', from, upcomingTo],
    queryFn: () => apiFetch<AllocationSummary[]>(`/api/calendar/going-out?from=${from}&to=${upcomingTo}`),
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
    isError:
      goingOut.isError ||
      dueBack.isError ||
      overdue.isError ||
      upcoming.isError ||
      outstanding.isError ||
      leavingMaintenance.isError,
  }
}
