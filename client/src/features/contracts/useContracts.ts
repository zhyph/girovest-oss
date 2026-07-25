import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import type { Contract, ContractDetail, NewContractFormValues, SigningTokenResponse } from './contractSchemas.ts'

export const CONTRACTS_KEY = ['contracts']

export function useContractsList({
  page = 1,
  pageSize = 20,
  search = '',
}: { page?: number; pageSize?: number; search?: string } = {}) {
  return useQuery({
    queryKey: [...CONTRACTS_KEY, page, pageSize, search],
    queryFn: () =>
      apiFetch<{ contracts: Contract[]; total: number; page: number; pageSize: number }>(
        `/api/contracts?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`,
      ),
    placeholderData: keepPreviousData,
  })
}

export function useContract(id: string | undefined, options: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: [...CONTRACTS_KEY, id],
    queryFn: () => apiFetch<ContractDetail>(`/api/contracts/${id}`),
    enabled: id !== undefined,
    refetchInterval: options.refetchInterval,
  })
}

function invalidateAfterMutation(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: CONTRACTS_KEY })
  queryClient.invalidateQueries({ queryKey: ['calendar'] })
  queryClient.invalidateQueries({ queryKey: ['products'] })
}

export function useCreateContract() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: NewContractFormValues) =>
      apiFetch<Contract>('/api/contracts', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => invalidateAfterMutation(queryClient),
  })
}

export function useCancelContract() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<Contract>(`/api/contracts/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => invalidateAfterMutation(queryClient),
  })
}

export function useIssueSigningToken() {
  return useMutation({
    mutationFn: (contractId: string) =>
      apiFetch<SigningTokenResponse>(`/api/contracts/${contractId}/sign-token`, { method: 'POST' }),
  })
}
