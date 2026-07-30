import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router'
import '../../i18n.ts'
import { SetupPage } from './SetupPage.tsx'
import { apiFetch } from '../../lib/api.ts'
import { clearToken } from '../../lib/auth.ts'

vi.mock('../../lib/api.ts', () => ({ apiFetch: vi.fn() }))

function renderSetupPage() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/configurar-loja']}>
        <Routes>
          <Route path="/configurar-loja" element={<SetupPage />} />
          <Route path="/" element={<div>Dashboard stub</div>} />
          <Route path="/login" element={<div>Login stub</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText('Nome da loja'), 'Loja Teste')
  await userEvent.type(screen.getByLabelText('Endereço'), 'Rua Teste, 1')
  await userEvent.type(screen.getByLabelText('Seu nome'), 'Dona Ana')
  await userEvent.type(screen.getByLabelText('Usuário'), 'dona-ana')
  await userEvent.type(screen.getByLabelText('Senha'), 'fake-password-1234')
  await userEvent.click(screen.getByRole('button', { name: 'Criar loja' }))
}

describe('SetupPage', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset()
    // The happy-path case below calls the real useAuth().login(), which
    // persists a token to localStorage — clear it so a later test's
    // useAuth() doesn't find it, enable its own staffQuery, and fire an
    // uncontrolled extra apiFetch('/api/auth/me') call.
    clearToken()
  })

  it('signs the owner in automatically and lands on the dashboard after setup succeeds', async () => {
    // onSubmit calls apiFetch three times in sequence: POST /api/setup (via
    // useCompleteSetup), then login()'s own POST /api/auth/login and
    // GET /api/auth/me — mocked in that order rather than by URL.
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ locationId: 'l1', staffId: 's1' })
      .mockResolvedValueOnce({ token: 'tok123' })
      .mockResolvedValueOnce({
        id: 's1', name: 'Dona Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR',
      })

    renderSetupPage()
    await fillAndSubmit()

    await waitFor(() => expect(screen.getByText('Dashboard stub')).toBeInTheDocument())
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/setup', expect.objectContaining({ method: 'POST' }))
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ login: 'dona-ana', password: 'fake-password-1234' }),
      }),
    )
    expect(apiFetch).toHaveBeenNthCalledWith(3, '/api/auth/me')
  })

  it('falls back to /login if auto-login fails right after a successful setup', async () => {
    // The shop was created either way — this simulates the login call itself
    // failing (a network hiccup, not a setup failure), which should not read
    // as "setup failed" (see the separate SETUP_ALREADY_COMPLETE case below).
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ locationId: 'l1', staffId: 's1' })
      .mockRejectedValueOnce(new Error('network error'))

    renderSetupPage()
    await fillAndSubmit()

    await waitFor(() => expect(screen.getByText('Login stub')).toBeInTheDocument())
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/setup',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('shows an error message when setup is already complete', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce({ code: 'SETUP_ALREADY_COMPLETE' })

    renderSetupPage()

    await userEvent.type(screen.getByLabelText('Nome da loja'), 'Loja Teste')
    await userEvent.type(screen.getByLabelText('Endereço'), 'Rua Teste, 1')
    await userEvent.type(screen.getByLabelText('Seu nome'), 'Dona Ana')
    await userEvent.type(screen.getByLabelText('Usuário'), 'dona-ana')
    await userEvent.type(screen.getByLabelText('Senha'), 'fake-password-1234')
    await userEvent.click(screen.getByRole('button', { name: 'Criar loja' }))

    expect(await screen.findByText('Esta loja já foi configurada.')).toBeInTheDocument()
  })

  it('shows field-level errors on an empty submit instead of a generic banner', async () => {
    renderSetupPage()

    await userEvent.click(screen.getByRole('button', { name: 'Criar loja' }))

    expect(await screen.findByText('Nome da loja é obrigatório')).toBeInTheDocument()
    expect(screen.getByText('Endereço é obrigatório')).toBeInTheDocument()
    expect(screen.getByText('Seu nome é obrigatório')).toBeInTheDocument()
    expect(screen.getByText('Usuário é obrigatório')).toBeInTheDocument()
    expect(screen.getByText('Senha deve ter pelo menos 8 caracteres')).toBeInTheDocument()
    expect(screen.queryByText('Algo deu errado. Tente novamente.')).not.toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  // The connectivity choice exists in the wizard precisely for the shop with
  // no shared Wi-Fi doing a fresh install: relay must be the default, or that
  // shop's first QR code is dead on arrival until someone finds Settings.
  it('submits connectivityMode relay by default', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ locationId: 'l1', staffId: 's1' })
      .mockRejectedValueOnce(new Error('skip auto-login'))

    renderSetupPage()
    await fillAndSubmit()

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/setup',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"connectivityMode":"relay"'),
        }),
      ),
    )
  })

  it('submits connectivityMode lan when the owner picks the shared local network option', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ locationId: 'l1', staffId: 's1' })
      .mockRejectedValueOnce(new Error('skip auto-login'))

    renderSetupPage()
    await userEvent.click(screen.getByLabelText('Rede local compartilhada'))
    await fillAndSubmit()

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/setup',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"connectivityMode":"lan"'),
        }),
      ),
    )
  })

  it('shows a too-short password error without touching the other fields', async () => {
    renderSetupPage()

    await userEvent.type(screen.getByLabelText('Nome da loja'), 'Loja Teste')
    await userEvent.type(screen.getByLabelText('Endereço'), 'Rua Teste, 1')
    await userEvent.type(screen.getByLabelText('Seu nome'), 'Dona Ana')
    await userEvent.type(screen.getByLabelText('Usuário'), 'dona-ana')
    await userEvent.type(screen.getByLabelText('Senha'), 'curta')
    await userEvent.click(screen.getByRole('button', { name: 'Criar loja' }))

    expect(await screen.findByText('Senha deve ter pelo menos 8 caracteres')).toBeInTheDocument()
    expect(screen.queryByText('Nome da loja é obrigatório')).not.toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })
})
