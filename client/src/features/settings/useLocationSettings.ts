import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import type { LocationSettings, LocationSettingsFormValues } from './settingsSchemas.ts'

const SETTINGS_KEY = ['settings']

export function useLocationSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiFetch<LocationSettings>('/api/settings'),
  })
}

export function useUpdateLocationSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: LocationSettingsFormValues) =>
      apiFetch<LocationSettings>('/api/settings', { method: 'PATCH', body: JSON.stringify(values) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SETTINGS_KEY })
      // The shop name reaches the nav rail and the window title through
      // /api/auth/me, not through this query — without this the brand line
      // keeps showing the old name until the next login.
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })
}
