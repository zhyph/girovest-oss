import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from './api.ts'

export interface SetupStatus {
  needsSetup: boolean
}

export interface CompleteSetupInput {
  shopName: string
  shopAddress: string
  ownerName: string
  ownerLogin: string
  ownerPassword: string
}

export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup', 'status'],
    queryFn: () => apiFetch<SetupStatus>('/api/setup/status'),
  })
}

export function useCompleteSetup() {
  return useMutation({
    mutationFn: (values: CompleteSetupInput) =>
      apiFetch<{ locationId: string; staffId: string }>('/api/setup', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
  })
}
