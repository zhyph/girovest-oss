import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router'
import '../../i18n.ts'
import { RecoverPasswordPage } from './RecoverPasswordPage.tsx'
import { apiFetch } from '../../lib/api.ts'

vi.mock('../../lib/api.ts', () => ({ apiFetch: vi.fn() }))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/recuperar-senha']}>
      <Routes>
        <Route path="/recuperar-senha" element={<RecoverPasswordPage />} />
        <Route path="/login" element={<div>Login stub</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function fillAndSubmit(password = 'brand-new-password') {
  await userEvent.type(screen.getByLabelText('Usuário'), 'ana')
  await userEvent.type(screen.getByLabelText('Código de recuperação'), 'ABCD-EFGH-JKMN-PQRS')
  await userEvent.type(screen.getByLabelText('Nova senha'), password)
  await userEvent.type(screen.getByLabelText('Confirmar nova senha'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }))
}

describe('RecoverPasswordPage', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset()
  })

  it('submits with suppressAuthLogoutEvent so a wrong code never fires a global logout mid-attempt', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ recoveryCode: 'NEXT-CODE-0000-1111' })

    renderPage()
    await fillAndSubmit()

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/auth/recover',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ login: 'ana', recoveryCode: 'ABCD-EFGH-JKMN-PQRS', newPassword: 'brand-new-password' }),
      }),
      { suppressAuthLogoutEvent: true },
    )
  })

  it('shows the freshly-rotated recovery code on success, not the old one', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ recoveryCode: 'NEXT-CODE-0000-1111' })

    renderPage()
    await fillAndSubmit()

    expect(await screen.findByText('NEXT-CODE-0000-1111')).toBeInTheDocument()
    expect(screen.queryByText('ABCD-EFGH-JKMN-PQRS')).not.toBeInTheDocument()
  })

  it('returns to /login after acknowledging the new code', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ recoveryCode: 'NEXT-CODE-0000-1111' })

    renderPage()
    await fillAndSubmit()

    await userEvent.click(await screen.findByRole('button', { name: 'Já guardei, continuar' }))
    expect(await screen.findByText('Login stub')).toBeInTheDocument()
  })

  it('shows a local error and never calls apiFetch when the passwords do not match', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Usuário'), 'ana')
    await userEvent.type(screen.getByLabelText('Código de recuperação'), 'ABCD-EFGH-JKMN-PQRS')
    await userEvent.type(screen.getByLabelText('Nova senha'), 'brand-new-password')
    await userEvent.type(screen.getByLabelText('Confirmar nova senha'), 'different-password')
    await userEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }))

    expect(await screen.findByText('As senhas não coincidem.')).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('shows a local error and never calls apiFetch when the new password is too short', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Usuário'), 'ana')
    await userEvent.type(screen.getByLabelText('Código de recuperação'), 'ABCD-EFGH-JKMN-PQRS')
    await userEvent.type(screen.getByLabelText('Nova senha'), 'short')
    await userEvent.type(screen.getByLabelText('Confirmar nova senha'), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }))

    expect(await screen.findByText('Senha muito curta. Use pelo menos 8 caracteres.')).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('shows the server error message on invalid credentials', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce({ code: 'INVALID_CREDENTIALS' })

    renderPage()
    await fillAndSubmit()

    expect(await screen.findByText('Usuário ou código de recuperação inválidos.')).toBeInTheDocument()
  })
})
