import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import type { Client, ClientFormValues } from './clientSchemas.ts'

export const CLIENTS_KEY = ['clients']

export function useClients() {
  return useQuery({
    queryKey: CLIENTS_KEY,
    queryFn: () => apiFetch<Client[]>('/api/clients'),
  })
}

export function useCreateClient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: ClientFormValues) =>
      apiFetch<Client>('/api/clients', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: (created) => {
      // Seeded ahead of the refetch below so a caller awaiting mutateAsync can
      // immediately find the new client in useClients() — the refetch this
      // still triggers is what reconciles it against the server's own state.
      const current = queryClient.getQueryData<Client[]>(CLIENTS_KEY)
      const newData = Array.isArray(current) ? [created, ...current] : [created]
      queryClient.setQueryData<Client[]>(CLIENTS_KEY, newData)
      queryClient.invalidateQueries({ queryKey: CLIENTS_KEY })
    },
  })
}

export function useUpdateClient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<ClientFormValues> }) =>
      apiFetch<Client>(`/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLIENTS_KEY }),
  })
}

export function useDeleteClient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/clients/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLIENTS_KEY }),
  })
}
