import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router'
import '../i18n.ts'
import { useAuth } from './useAuth.ts'
import * as api from './api.ts'
import { getToken } from './auth.ts'
import { Toaster } from '../components/ui/sonner.tsx'

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient()
  return (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
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

  it('clears the token when the follow-up /api/auth/me call fails after login', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path) => {
      if (path === '/api/auth/login') return { token: 'new-token' } as never
      if (path === '/api/auth/me') throw new api.ApiError('SERVER_ERROR', 500, 'boom')
      throw new Error('unexpected path')
    })

    const { result } = renderHook(() => useAuth(), { wrapper })

    await expect(act(() => result.current.login('ana', 'senha123'))).rejects.toThrow('boom')

    expect(getToken()).toBeNull()
    expect(result.current.isLoggedIn).toBe(false)
  })

  // The token is cleared by apiFetch itself on a 401, not by a listener here.
  // useAuth deliberately no longer reacts to 'auth:logout' at all — see
  // SessionExpiryProvider, and SessionExpiredDialog.test.tsx for what happens
  // instead of the old navigate-away.
  it('does not navigate or clear the cache on the auth:logout event', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ id: '1', name: 'Ana', login: 'ana', role: 'owner', locationId: 'l1' } as never)
    const { setToken } = await import('./auth.ts')
    setToken('existing-token')

    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.staff?.name).toBe('Ana'))

    act(() => window.dispatchEvent(new Event('auth:logout')))

    // Still cached: the re-auth dialog names the account from it, and the
    // screen underneath must not be torn down.
    expect(result.current.staff?.name).toBe('Ana')
  })

  it('navigates to /login when logout() is called, not just clearing the token', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ id: '1', name: 'Ana', role: 'owner', locationId: 'l1' } as never)
    const { setToken } = await import('./auth.ts')
    setToken('existing-token')

    function Probe() {
      const { logout } = useAuth()
      const location = useLocation()
      return (
        <div>
          <span data-testid="path">{location.pathname}</span>
          <button onClick={logout}>sair</button>
        </div>
      )
    }

    const queryClient = new QueryClient()
    render(
      <MemoryRouter initialEntries={['/']}>
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      </MemoryRouter>,
    )

    await userEvent.click(screen.getByText('sair'))

    expect(screen.getByTestId('path')).toHaveTextContent('/login')
    expect(getToken()).toBeNull()
  })

  // The original incident behind this: a session invalidated out from under
  // someone redirected to /login with nothing explaining why, which read as
  // "the app just broke". A toast was the first answer; it stacked one copy
  // per mounted useAuth consumer, and it still did not stop the redirect from
  // destroying whatever she was in the middle of. The explanation now lives in
  // the re-auth dialog, which is also the way back.
  //
  // This asserts what actually changed — that useAuth no longer REACTS to the
  // event at all. An earlier version asserted "no toast appears", which could
  // not fail: the string it searched for had been deleted from the locale in
  // the same change, so even the old listener would have rendered a raw key
  // and matched nothing.
  it('does not navigate away when the session expires', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ id: '1', name: 'Ana', login: 'ana', role: 'owner', locationId: 'l1' } as never)
    const { setToken } = await import('./auth.ts')
    setToken('existing-token')

    function Probe() {
      const location = useLocation()
      useAuth()
      return <span data-testid="path">{location.pathname}</span>
    }

    const queryClient = new QueryClient()
    render(
      <MemoryRouter initialEntries={['/contratos']}>
        <QueryClientProvider client={queryClient}>
          <Probe />
          <Toaster />
        </QueryClientProvider>
      </MemoryRouter>,
    )

    act(() => window.dispatchEvent(new Event('auth:logout')))

    // The old listener called logout(), which navigates. Nothing here may.
    expect(screen.getByTestId('path')).toHaveTextContent('/contratos')
    expect(screen.queryByText(/sessão expirou/i)).not.toBeInTheDocument()
  })
})
