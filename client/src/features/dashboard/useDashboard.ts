import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'

export interface AllocationSummary {
  id: string
  productId: string
  clientId: string
  checkoutDate: string
  dueDate: string
  status: string
}

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

export function useDashboard() {
  const from = startOfToday().toISOString()
  const to = endOfToday().toISOString()

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

  return {
    goingOutToday: goingOut.data ?? [],
    dueBackToday: dueBack.data ?? [],
    overdue: overdue.data ?? [],
    isLoading: goingOut.isLoading || dueBack.isLoading || overdue.isLoading,
    isError: goingOut.isError || dueBack.isError || overdue.isError,
  }
}
