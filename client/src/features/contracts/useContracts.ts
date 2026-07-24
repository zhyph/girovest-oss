import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import type { Contract, ContractDetail, NewContractFormValues, SigningTokenResponse } from './contractSchemas.ts'

const CONTRACTS_KEY = ['contracts']

export function useContractsList() {
  return useQuery({
    queryKey: CONTRACTS_KEY,
    queryFn: () => apiFetch<Contract[]>('/api/contracts'),
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
