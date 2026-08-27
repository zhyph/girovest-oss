import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router'
import '../../i18n.ts'
import * as api from '../../lib/api.ts'
import { setToken, getToken } from '../../lib/auth.ts'
import { SessionExpiryProvider } from '../../lib/SessionExpiryContext.tsx'
import { ProtectedRoute } from '../../app/ProtectedRoute.tsx'
import { AppLayout } from '../../app/AppLayout.tsx'

const STAFF = { id: '1', name: 'Ana', login: 'ana', role: 'owner', locationId: 'l1', locationName: 'Loja', locale: 'pt-BR' }

/**
 * Stands in for any screen with work in progress on it. The whole point of the
 * change under test is that this component is never unmounted, so its state
 * survives the session lapsing.
 */
function HalfFilledForm() {
  const [value, setValue] = useState('')
  const location = useLocation()
  return (
    <div>
      <span data-testid="path">{location.pathname}</span>
      <label>
        Cliente
        <input value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
    </div>
  )
}

/**
 * Mounts the screen through AppLayout, exactly as the router does.
 *
 * An earlier version of this harness rendered ProtectedRoute straight onto the
 * form, which made the headline test unable to observe the very thing that
 * destroys the work: AppLayout's own `isErrorStaff` branch, which unmounts
 * Sidebar and Outlet together. The test passed in a tree where the only
 * component that could break it was absent.
 */
function renderProtectedScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['auth', 'me'], STAFF)
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/contratos']}>
        <SessionExpiryProvider>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/contratos" element={<HalfFilledForm />} />
              </Route>
            </Route>
            <Route path="/login" element={<div>tela de login</div>} />
          </Routes>
        </SessionExpiryProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('session expiry', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    setToken('existing-token')
  })

  it('CRITICAL: a lapsed session does not destroy the work on screen', async () => {
    /*
      The defect: any 401 called logout(), which navigates and unmounts the
      protected tree. Several minutes into "Novo contrato" — client, dress,
      dates, six parcelas — the SSE-ticket timer's four-minute POST discovers
      the session has lapsed and every field vanishes, without her touching
      anything. That path is in the server's RENEWAL_EXCLUDED_PATHS, so it can
      only ever discover a dead session, never extend a live one.
    */
    vi.spyOn(api, 'apiFetch').mockResolvedValue(STAFF as never)
    renderProtectedScreen()

    await userEvent.type(screen.getByLabelText('Cliente'), 'Maria Souza')

    // apiFetch clears the token on a 401 and fires this.
    act(() => {
      localStorage.removeItem('dress-store-token')
      window.dispatchEvent(new Event('auth:logout'))
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('path')).toHaveTextContent('/contratos')
    expect(screen.getByLabelText('Cliente')).toHaveValue('Maria Souza')
  })

  it("CRITICAL: a 401 on /api/auth/me does not tear the screen down either", async () => {
    /*
      The most ordinary way a lapsed session is discovered is that she comes
      back to the machine and clicks the window: TanStack's default
      refetchOnWindowFocus refetches /me, it 401s, and the staff query is
      retry:false so it lands in `error` permanently. AppLayout's
      `isErrorStaff` branch then unmounted Sidebar AND Outlet — the form
      included — and the dialog floated over a bare error screen. The PR's
      flagship path (the SSE-ticket timer) never touches /me, so this went
      unnoticed.
    */
    const failing = vi.spyOn(api, 'apiFetch').mockResolvedValue(STAFF as never)
    renderProtectedScreen()
    await userEvent.type(screen.getByLabelText('Cliente'), 'Maria Souza')

    // The /me refetch fails the way a lapsed session makes it fail.
    failing.mockRejectedValue(Object.assign(new Error('401'), { code: 'UNAUTHORIZED' }))
    act(() => {
      localStorage.removeItem('dress-store-token')
      window.dispatchEvent(new Event('auth:logout'))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Cliente')).toHaveValue('Maria Souza')
    expect(screen.queryByText(/Não foi possível carregar seu perfil/i)).not.toBeInTheDocument()
  })

  it('CRITICAL: hides the screen contents while unauthenticated, without unmounting them', async () => {
    // Both halves matter and they pull against each other. The work must
    // SURVIVE (state intact, no unmount) and must not be READABLE (this is a
    // shop counter, and a session lapses precisely when nobody is at the
    // machine). Anything that unmounts to hide it fails the first; anything
    // that leaves it legible behind the scrim fails the second.
    vi.spyOn(api, 'apiFetch').mockResolvedValue(STAFF as never)
    renderProtectedScreen()
    await userEvent.type(screen.getByLabelText('Cliente'), 'Maria Souza')

    act(() => {
      localStorage.removeItem('dress-store-token')
      window.dispatchEvent(new Event('auth:logout'))
    })

    const field = screen.getByLabelText('Cliente')
    // Still mounted, still holding her input.
    expect(field).toHaveValue('Maria Souza')
    // But not readable: the guard hides everything below it.
    const guard = field.closest('[style*="visibility"]')
    expect(guard).not.toBeNull()
    expect(guard).toHaveStyle({ visibility: 'hidden' })
    // The dialog itself is portalled outside the guard, so it stays visible.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('reveals the screen again once she is back in', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path) => {
      if (path === '/api/auth/login') return { token: 'fresh-token' } as never
      return STAFF as never
    })
    renderProtectedScreen()
    act(() => {
      localStorage.removeItem('dress-store-token')
      window.dispatchEvent(new Event('auth:logout'))
    })

    await userEvent.type(screen.getByLabelText('Senha'), 'senha123')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    const field = await screen.findByLabelText('Cliente')
    expect(field.closest('[style*="visibility"]')).toBeNull()
  })

  it('names the account and asks only for the password', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue(STAFF as never)
    renderProtectedScreen()

    act(() => window.dispatchEvent(new Event('auth:logout')))

    expect(screen.getByText('ana')).toBeInTheDocument()
    expect(screen.getByLabelText('Senha')).toHaveFocus()
  })

  it('puts her back to work in place, with the form still filled in', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path) => {
      if (path === '/api/auth/login') return { token: 'fresh-token' } as never
      return STAFF as never
    })
    renderProtectedScreen()

    await userEvent.type(screen.getByLabelText('Cliente'), 'Maria Souza')
    act(() => {
      localStorage.removeItem('dress-store-token')
      window.dispatchEvent(new Event('auth:logout'))
    })

    await userEvent.type(screen.getByLabelText('Senha'), 'senha123')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(await screen.findByLabelText('Cliente')).toHaveValue('Maria Souza')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(getToken()).toBe('fresh-token')
    expect(screen.getByTestId('path')).toHaveTextContent('/contratos')
  })

  it('keeps the dialog open and says why when the password is wrong', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path) => {
      if (path === '/api/auth/login') throw Object.assign(new Error('bad'), { code: 'INVALID_CREDENTIALS' })
      return STAFF as never
    })
    renderProtectedScreen()

    act(() => window.dispatchEvent(new Event('auth:logout')))
    await userEvent.type(screen.getByLabelText('Senha'), 'errada')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Usuário ou senha inválidos.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('still offers a deliberate way out to the login screen, once confirmed', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue(STAFF as never)
    const confirmed = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderProtectedScreen()

    act(() => window.dispatchEvent(new Event('auth:logout')))
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }))

    expect(confirmed).toHaveBeenCalled()
    expect(await screen.findByText('tela de login')).toBeInTheDocument()
  })

  it('CRITICAL: declining the confirmation keeps her work, which Sair would discard', async () => {
    // "Sair" sits directly beside help text promising nothing she was filling
    // in has been lost, and it is the one control here that makes that untrue.
    vi.spyOn(api, 'apiFetch').mockResolvedValue(STAFF as never)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderProtectedScreen()

    await userEvent.type(screen.getByLabelText('Cliente'), 'Maria Souza')
    act(() => window.dispatchEvent(new Event('auth:logout')))
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }))

    expect(screen.queryByText('tela de login')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Cliente')).toHaveValue('Maria Souza')
  })

  it('sends someone with no session at all straight to login, with nothing to preserve', () => {
    localStorage.clear()
    vi.spyOn(api, 'apiFetch').mockResolvedValue(STAFF as never)
    renderProtectedScreen()

    expect(screen.getByText('tela de login')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
