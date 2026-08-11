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

  // Returns a recovery code exactly once: the server mints one on the spot
  // for any account that predates the recovery-code feature (see
  // authRoutes.ts's POST /login), and this is the only place it can ever be
  // handed back. LoginPage shows it before continuing to the app.
  async function login(login: string, password: string): Promise<string | null> {
    // Both calls suppress the global 'auth:logout' event a 401 would otherwise
    // fire: this function already handles its own failure (clearToken + throw,
    // caught by LoginPage), and the login page is already sitting on /login —
    // the event's navigate()+cache-clear only fights that local handling. See
    // ApiFetchOptions in api.ts.
    const { token, recoveryCode } = await apiFetch<{ token: string; recoveryCode?: string }>(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ login, password }) },
      { suppressAuthLogoutEvent: true },
    )
    setToken(token)
    // Populate the cache directly rather than invalidating: the staff query is
    // `enabled: Boolean(getToken())`, which was false while unauthenticated, so
    // it isn't an "active" query yet and `invalidateQueries` (refetchType:
    // 'active' by default) would not refetch it.
    try {
      const staff = await apiFetch<StaffMe>('/api/auth/me', {}, { suppressAuthLogoutEvent: true })
      queryClient.setQueryData(['auth', 'me'], staff)
    } catch (error) {
      // Don't leave a persisted token if we couldn't confirm the session:
      // otherwise isLoggedIn flips to true while `staff` stays undefined,
      // and ProtectedRoute (which only checks isLoggedIn) would let a
      // "failed" login through with no profile data.
      clearToken()
      throw error
    }
    return recoveryCode ?? null
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
    isErrorStaff: staffQuery.isError,
    refetchStaff: staffQuery.refetch,
    login,
    logout,
    isLoggedIn: Boolean(getToken()),
  }
}
