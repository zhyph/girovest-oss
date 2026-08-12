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

  it('logs out and clears the token on the auth:logout event', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ id: '1', name: 'Ana', role: 'owner', locationId: 'l1' } as never)
    const { setToken } = await import('./auth.ts')
    setToken('existing-token')

    renderHook(() => useAuth(), { wrapper })
    act(() => window.dispatchEvent(new Event('auth:logout')))

    expect(getToken()).toBeNull()
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

  // Regression test for a real incident: a session invalidated out from
  // under someone (see auth:logout below) redirected to /login with
  // nothing explaining why, which read as "the app just broke." The 'Sair'
  // button calls logout() directly and needs no explanation -- only the
  // auth:logout event (something ELSE ending the session) should ever show
  // this toast.
  it('shows a toast on auth:logout, but not on a direct logout() call', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ id: '1', name: 'Ana', role: 'owner', locationId: 'l1' } as never)
    const { setToken } = await import('./auth.ts')
    setToken('existing-token')

    function Probe() {
      const { logout } = useAuth()
      return <button onClick={logout}>sair manual</button>
    }

    const queryClient = new QueryClient()
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <Probe />
          <Toaster />
        </QueryClientProvider>
      </MemoryRouter>,
    )

    await userEvent.click(screen.getByText('sair manual'))
    expect(screen.queryByText(/sessão expirou/i)).not.toBeInTheDocument()

    act(() => window.dispatchEvent(new Event('auth:logout')))
    expect(await screen.findByText(/sessão expirou/i)).toBeInTheDocument()
  })
})
