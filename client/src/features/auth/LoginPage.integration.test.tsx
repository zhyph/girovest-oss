import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router'
import '../../i18n.ts'
import { LoginPage } from './LoginPage.tsx'
import { apiFetch } from '../../lib/api.ts'
import { clearToken } from '../../lib/auth.ts'

vi.mock('../../lib/api.ts', () => ({ apiFetch: vi.fn() }))

/**
 * Deliberately does NOT mock useAuth/useSetupStatus, unlike LoginPage.test.tsx
 * -- a code review found that mocking useAuth with a hardcoded `isLoggedIn:
 * false` makes the existing backfill test pass even if LoginPage's own
 * `if (backfilledCode)` check were moved BELOW `if (isLoggedIn)` (the exact
 * regression it claims to guard against), because the mock never flips
 * isLoggedIn true the way the real hook does the instant login() resolves.
 * This exercises the real useAuth + real React Query cache update, so a
 * reordering regression actually fails it.
 */
function renderRealLoginPage() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Dashboard stub</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('LoginPage (integration, real useAuth)', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset()
    clearToken()
  })

  it('shows the backfilled recovery code, never the dashboard, even though isLoggedIn is already true by then', async () => {
    vi.mocked(apiFetch)
      .mockImplementationOnce((path: string) => {
        if (path === '/api/setup/status') return Promise.resolve({ needsSetup: false })
        throw new Error(`unexpected call: ${path}`)
      })
      .mockResolvedValueOnce({ token: 'tok123', recoveryCode: 'V9GV-3EGF-Z6UJ-S87G' })
      .mockResolvedValueOnce({
        id: 's1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR',
      })

    renderRealLoginPage()
    await waitFor(() => expect(screen.getByLabelText('Usuário')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('Usuário'), 'ana')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha123')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByText('V9GV-3EGF-Z6UJ-S87G')).toBeInTheDocument()
    expect(screen.queryByText('Dashboard stub')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Já guardei, continuar' }))
    expect(await screen.findByText('Dashboard stub')).toBeInTheDocument()
  })
})
