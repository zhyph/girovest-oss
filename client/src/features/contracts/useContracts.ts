import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiFetch, BACKGROUND_REQUEST_INIT } from '../../lib/api.ts'
import { overdueAsOf } from '../../lib/date.ts'
import type { Contract, ContractDetail, NewContractFormValues, SigningTokenResponse } from './contractSchemas.ts'

export const CONTRACTS_KEY = ['contracts']

export const CONTRACT_STATUS_FILTERS = ['all', 'active', 'overdue', 'unsigned'] as const
export type ContractStatusFilter = (typeof CONTRACT_STATUS_FILTERS)[number]

export interface ContractStatusCounts {
  all: number
  active: number
  overdue: number
  unsigned: number
}

export interface ContractsPage {
  contracts: Contract[]
  total: number
  page: number
  pageSize: number
  counts: ContractStatusCounts
}

export function useContractsList({
  page = 1,
  pageSize = 20,
  search = '',
  status = 'all',
}: { page?: number; pageSize?: number; search?: string; status?: ContractStatusFilter } = {}) {
  const asOf = overdueAsOf().toISOString()
  return useQuery({
    queryKey: [...CONTRACTS_KEY, page, pageSize, search, status, asOf],
    queryFn: () =>
      apiFetch<ContractsPage>(
        `/api/contracts?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}` +
          `&status=${status}&asOf=${encodeURIComponent(asOf)}`,
      ),
    placeholderData: keepPreviousData,
  })
}

export function useContract(id: string | undefined, options: { refetchInterval?: number | false } = {}) {
  // A polling caller is unattended traffic: SignRemotelyModal refetches every
  // 3 seconds for as long as it is open, and it never closes itself, so the
  // requests keep coming after everyone has gone home. Mark them, or the
  // sliding session renewal in requireAuth would keep that terminal logged in
  // forever. The server cannot spot this by path — the very same URL is what an
  // attended click on a contract produces.
  const isPolled = Boolean(options.refetchInterval)
  return useQuery({
    queryKey: [...CONTRACTS_KEY, id],
    queryFn: () =>
      apiFetch<ContractDetail>(`/api/contracts/${id}`, isPolled ? BACKGROUND_REQUEST_INIT : {}),
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

export function useSetInstallmentPaid() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ contractId, installmentId, paid }: { contractId: string; installmentId: string; paid: boolean }) =>
      apiFetch<ContractDetail>(`/api/contracts/${contractId}/installments/${installmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ paid }),
      }),
    onSuccess: () => invalidateAfterMutation(queryClient),
  })
}

export function useIssueSigningToken() {
  return useMutation({
    mutationFn: (contractId: string) =>
      apiFetch<SigningTokenResponse>(`/api/contracts/${contractId}/sign-token`, { method: 'POST' }),
  })
}
