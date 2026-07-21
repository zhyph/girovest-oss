import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
    // Single-shot check on first launch: retrying 3 times with backoff would
    // delay the setup/login gate by several seconds at the exact moment it
    // matters most.
    retry: false,
  })
}

export function useCompleteSetup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (values: CompleteSetupInput) =>
      apiFetch<{ locationId: string; staffId: string }>('/api/setup', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      // Populate the cache directly rather than invalidating: LoginPage reads
      // ['setup', 'status'] synchronously on mount right after navigation, and
      // invalidateQueries only kicks off a background refetch, leaving a gap
      // where the stale `needsSetup: true` value would bounce the user right
      // back to the setup screen.
      queryClient.setQueryData(['setup', 'status'], { needsSetup: false })
    },
  })
}
