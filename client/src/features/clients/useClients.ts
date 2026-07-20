import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import type { Client, ClientFormValues } from './clientSchemas.ts'

const CLIENTS_KEY = ['clients']

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLIENTS_KEY }),
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
