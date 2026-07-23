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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_KEY }),
  })
}
