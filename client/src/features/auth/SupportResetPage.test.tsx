import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router'
import '../../i18n.ts'
import { SupportResetPage } from './SupportResetPage.tsx'
import { apiFetch } from '../../lib/api.ts'

vi.mock('../../lib/api.ts', () => ({ apiFetch: vi.fn() }))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/recuperar-senha/suporte']}>
      <Routes>
        <Route path="/recuperar-senha/suporte" element={<SupportResetPage />} />
        <Route path="/recuperar-senha" element={<div>Recover stub</div>} />
        <Route path="/login" element={<div>Login stub</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function setBridge(requestPasswordReset: ((login: string) => Promise<unknown>) | undefined) {
  ;(window as Window & { girovest?: unknown }).girovest = requestPasswordReset ? { requestPasswordReset } : undefined
}

describe('SupportResetPage', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset()
  })

  afterEach(() => {
    setBridge(undefined)
  })

  it('redirects to /recuperar-senha on the hosted web build (no bridge)', async () => {
    setBridge(undefined)
    renderPage()
    expect(await screen.findByText('Recover stub')).toBeInTheDocument()
  })

  it('shows the pending code after requesting help', async () => {
    setBridge(async () => ({ status: 'pending', code: 'B2A4F6C8' }))
    renderPage()

    await userEvent.type(screen.getByLabelText('Usuário'), 'ana')
    await userEvent.click(screen.getByRole('button', { name: 'Pedir ajuda ao suporte' }))

    expect(await screen.findByText('B2A4F6C8')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verificar novamente' })).toBeInTheDocument()
  })

  it('shows the denied message', async () => {
    setBridge(async () => ({ status: 'denied' }))
    renderPage()

    await userEvent.type(screen.getByLabelText('Usuário'), 'ana')
    await userEvent.click(screen.getByRole('button', { name: 'Pedir ajuda ao suporte' }))

    expect(await screen.findByText('Este pedido foi negado. Entre em contato com o suporte por outro canal.')).toBeInTheDocument()
  })

  it('once approved, finalizing calls reset-with-support-token with the token and shows the new recovery code', async () => {
    setBridge(async () => ({ status: 'approved', token: 'signed.token' }))
    vi.mocked(apiFetch).mockResolvedValueOnce({ recoveryCode: 'ZZZZ-YYYY-XXXX-WWWW' })

    renderPage()
    await userEvent.type(screen.getByLabelText('Usuário'), 'ana')
    await userEvent.click(screen.getByRole('button', { name: 'Pedir ajuda ao suporte' }))

    await userEvent.type(await screen.findByLabelText('Nova senha', { exact: true }), 'fresh-password-1')
    await userEvent.type(screen.getByLabelText('Confirmar nova senha'), 'fresh-password-1')
    await userEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }))

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/auth/reset-with-support-token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ login: 'ana', token: 'signed.token', newPassword: 'fresh-password-1' }),
      }),
      { suppressAuthLogoutEvent: true },
    )
    expect(await screen.findByText('ZZZZ-YYYY-XXXX-WWWW')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Já guardei, continuar' }))
    expect(await screen.findByText('Login stub')).toBeInTheDocument()
  })

  it('shows a local error and never calls apiFetch when the new password is too short', async () => {
    setBridge(async () => ({ status: 'approved', token: 'signed.token' }))

    renderPage()
    await userEvent.type(screen.getByLabelText('Usuário'), 'ana')
    await userEvent.click(screen.getByRole('button', { name: 'Pedir ajuda ao suporte' }))

    await userEvent.type(await screen.findByLabelText('Nova senha', { exact: true }), 'short')
    await userEvent.type(screen.getByLabelText('Confirmar nova senha'), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }))

    expect(await screen.findByText('Senha muito curta. Use pelo menos 8 caracteres.')).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  // Previously an uncaught rejection: the button just did nothing, the exact
  // class of silent failure this whole feature exists to eliminate.
  it('shows unreachable, not a silent no-op, when the IPC call itself rejects', async () => {
    setBridge(async () => {
      throw new Error('ipc handler not registered yet')
    })
    renderPage()

    await userEvent.type(screen.getByLabelText('Usuário'), 'ana')
    await userEvent.click(screen.getByRole('button', { name: 'Pedir ajuda ao suporte' }))

    expect(await screen.findByText('Não foi possível falar com o suporte agora. Verifique a internet e tente novamente.')).toBeInTheDocument()
  })

  // The Worker accepts a pending request for ANY non-empty login, typo or
  // not -- it can never be approved if it doesn't match a real account, so
  // there has to be a way back to fix it rather than "retry forever".
  it('lets her go back and correct the login from the pending screen', async () => {
    setBridge(async () => ({ status: 'pending', code: 'B2A4F6C8' }))
    renderPage()

    await userEvent.type(screen.getByLabelText('Usuário'), 'anaa')
    await userEvent.click(screen.getByRole('button', { name: 'Pedir ajuda ao suporte' }))
    expect(await screen.findByText('B2A4F6C8')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Corrigir usuário' }))
    expect(await screen.findByLabelText('Usuário')).toHaveValue('anaa')
    expect(screen.queryByText('B2A4F6C8')).not.toBeInTheDocument()
  })

  it('rejects mismatched passwords locally without calling apiFetch', async () => {
    setBridge(async () => ({ status: 'approved', token: 'signed.token' }))

    renderPage()
    await userEvent.type(screen.getByLabelText('Usuário'), 'ana')
    await userEvent.click(screen.getByRole('button', { name: 'Pedir ajuda ao suporte' }))

    await userEvent.type(await screen.findByLabelText('Nova senha', { exact: true }), 'fresh-password-1')
    await userEvent.type(screen.getByLabelText('Confirmar nova senha'), 'different-password')
    await userEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }))

    expect(await screen.findByText('As senhas não coincidem.')).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })
})
