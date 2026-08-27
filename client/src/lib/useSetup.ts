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
    /*
     * 'always', because this app's server is on the same machine.
     *
     * React Query's default 'online' mode PAUSES a query whenever
     * `navigator.onLine` is false — it never fires the request, so the query
     * sits in `pending` forever and never reaches an error. With the login
     * gate keyed on that, an operator whose router is off or whose wifi is
     * down got a spinner and no way to reach the form, on an offline-first
     * desktop app talking to localhost. `login()` itself is a plain apiFetch
     * and was never paused, so before the gate existed she simply logged in.
     */
    networkMode: 'always',
  })
}

export function useCompleteSetup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (values: CompleteSetupInput) =>
      apiFetch<{ locationId: string; staffId: string; recoveryCode: string }>('/api/setup', {
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
