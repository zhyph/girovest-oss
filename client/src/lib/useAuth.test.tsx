import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from './useAuth.ts'
import * as api from './api.ts'
import { getToken } from './auth.ts'

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient()
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useAuth', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('logs in, stores the token, and reports isLoggedIn', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path) => {
      if (path === '/api/auth/login') return { token: 'new-token' } as never
      if (path === '/api/auth/me') return { id: '1', name: 'Ana', role: 'owner', locationId: 'l1' } as never
      throw new Error('unexpected path')
    })

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(() => result.current.login('ana', 'senha123'))

    expect(getToken()).toBe('new-token')
    await waitFor(() => expect(result.current.isLoggedIn).toBe(true))
    await waitFor(() => expect(result.current.staff?.name).toBe('Ana'))
  })

  it('logs out and clears the token on the auth:logout event', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ id: '1', name: 'Ana', role: 'owner', locationId: 'l1' } as never)
    const { setToken } = await import('./auth.ts')
    setToken('existing-token')

    renderHook(() => useAuth(), { wrapper })
    act(() => window.dispatchEvent(new Event('auth:logout')))

    expect(getToken()).toBeNull()
  })
})
