import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { apiFetch } from './api.ts'
import { getToken, setToken, clearToken } from './auth.ts'

export interface StaffMe {
  id: string
  name: string
  role: 'owner' | 'staff'
  locationId: string
  locationName: string
  locale: string
}

export function useAuth() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const staffQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiFetch<StaffMe>('/api/auth/me'),
    enabled: Boolean(getToken()),
    retry: false,
  })

  useEffect(() => {
    window.addEventListener('auth:logout', logout)
    return () => window.removeEventListener('auth:logout', logout)
  }, [queryClient])

  async function login(login: string, password: string) {
    const { token } = await apiFetch<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    })
    setToken(token)
    // Populate the cache directly rather than invalidating: the staff query is
    // `enabled: Boolean(getToken())`, which was false while unauthenticated, so
    // it isn't an "active" query yet and `invalidateQueries` (refetchType:
    // 'active' by default) would not refetch it.
    try {
      const staff = await apiFetch<StaffMe>('/api/auth/me')
      queryClient.setQueryData(['auth', 'me'], staff)
    } catch (error) {
      // Don't leave a persisted token if we couldn't confirm the session:
      // otherwise isLoggedIn flips to true while `staff` stays undefined,
      // and ProtectedRoute (which only checks isLoggedIn) would let a
      // "failed" login through with no profile data.
      clearToken()
      throw error
    }
  }

  function logout() {
    clearToken()
    // setQueryData(key, undefined) is a no-op in TanStack Query (it treats an
    // undefined value as "no update"), so removeQueries is what actually
    // clears the cache and notifies subscribers. Navigating explicitly here
    // is what actually leaves the protected route tree — isLoggedIn is a
    // plain synchronous localStorage read, not React state, so nothing
    // forces a re-render/redirect without it.
    queryClient.removeQueries({ queryKey: ['auth', 'me'] })
    navigate('/login', { replace: true })
  }

  return {
    staff: staffQuery.data,
    isLoadingStaff: staffQuery.isLoading,
    login,
    logout,
    isLoggedIn: Boolean(getToken()),
  }
}
