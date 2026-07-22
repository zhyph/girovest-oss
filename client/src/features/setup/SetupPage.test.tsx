import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router'
import '../../i18n.ts'
import { SetupPage } from './SetupPage.tsx'
import { apiFetch } from '../../lib/api.ts'

vi.mock('../../lib/api.ts', () => ({ apiFetch: vi.fn() }))

function renderSetupPage() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/configurar-loja']}>
        <Routes>
          <Route path="/configurar-loja" element={<SetupPage />} />
          <Route path="/login" element={<div>Login stub</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SetupPage', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset()
  })

  it('submits the form and redirects to /login on success', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ locationId: 'l1', staffId: 's1' })

    renderSetupPage()

    await userEvent.type(screen.getByLabelText('Nome da loja'), 'Loja Teste')
    await userEvent.type(screen.getByLabelText('Endereço'), 'Rua Teste, 1')
    await userEvent.type(screen.getByLabelText('Seu nome'), 'Dona Ana')
    await userEvent.type(screen.getByLabelText('Usuário'), 'dona-ana')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-forte-123')
    await userEvent.click(screen.getByRole('button', { name: 'Criar loja' }))

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
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-forte-123')
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
