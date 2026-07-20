import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import type { Allocation, NewAllocationFormValues } from './allocationSchemas.ts'

const ALLOCATIONS_KEY = ['allocations']

export function useAllocationsList() {
  return useQuery({
    queryKey: ALLOCATIONS_KEY,
    queryFn: () => apiFetch<Allocation[]>('/api/allocations'),
  })
}

function invalidateAfterMutation(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ALLOCATIONS_KEY })
  queryClient.invalidateQueries({ queryKey: ['calendar'] })
  queryClient.invalidateQueries({ queryKey: ['products'] })
}

export function useCreateAllocation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: NewAllocationFormValues) =>
      apiFetch<Allocation>('/api/allocations', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => invalidateAfterMutation(queryClient),
  })
}

export function useCheckOutAllocation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, conditionNotesOut, depositCollected }: { id: string; conditionNotesOut?: string; depositCollected?: number }) =>
      apiFetch<Allocation>(`/api/allocations/${id}/check-out`, {
        method: 'POST',
        body: JSON.stringify({ conditionNotesOut, depositCollected }),
      }),
    onSuccess: () => invalidateAfterMutation(queryClient),
  })
}

export function useReturnAllocation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, conditionNotesIn, depositReturned }: { id: string; conditionNotesIn?: string; depositReturned?: number }) =>
      apiFetch<Allocation>(`/api/allocations/${id}/return`, {
        method: 'POST',
        body: JSON.stringify({ conditionNotesIn, depositReturned }),
      }),
    onSuccess: () => invalidateAfterMutation(queryClient),
  })
}

export function useCancelAllocation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<Allocation>(`/api/allocations/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => invalidateAfterMutation(queryClient),
  })
}

export function useProductAvailability(productId: string, checkoutDate: string, dueDate: string) {
  return useQuery({
    queryKey: ['availability', productId, checkoutDate, dueDate],
    queryFn: () =>
      apiFetch<{ available: boolean }>(
        `/api/allocations/products/${productId}/availability?checkoutDate=${checkoutDate}&dueDate=${dueDate}`,
      ),
    enabled: Boolean(productId && checkoutDate && dueDate),
  })
}
