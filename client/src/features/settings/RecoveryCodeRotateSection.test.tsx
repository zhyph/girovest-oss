import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { RecoveryCodeRotateSection } from './RecoveryCodeRotateSection.tsx'
import { apiFetch } from '../../lib/api.ts'

vi.mock('../../lib/api.ts', () => ({ apiFetch: vi.fn() }))

describe('RecoveryCodeRotateSection', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset()
  })

  it('asks for the current password before rotating, and sends it with suppressAuthLogoutEvent', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ recoveryCode: 'FRESH-CODE-0000-1111' })

    render(<RecoveryCodeRotateSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Gerar novo código de recuperação' }))

    expect(apiFetch).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Confirme sua senha atual'), 'correct-horse')
    await userEvent.click(screen.getByRole('button', { name: 'Gerar novo código de recuperação' }))

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/auth/recovery-code/rotate',
      { method: 'POST', body: JSON.stringify({ currentPassword: 'correct-horse' }) },
      { suppressAuthLogoutEvent: true },
    )
    expect(await screen.findByText('FRESH-CODE-0000-1111')).toBeInTheDocument()
  })

  it('cancelling the password prompt returns to the rotate button without calling apiFetch', async () => {
    render(<RecoveryCodeRotateSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Gerar novo código de recuperação' }))
    await userEvent.type(screen.getByLabelText('Confirme sua senha atual'), 'something')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByRole('button', { name: 'Gerar novo código de recuperação' })).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('returns to the rotate button after acknowledging the code', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ recoveryCode: 'FRESH-CODE-0000-1111' })

    render(<RecoveryCodeRotateSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Gerar novo código de recuperação' }))
    await userEvent.type(screen.getByLabelText('Confirme sua senha atual'), 'correct-horse')
    await userEvent.click(screen.getByRole('button', { name: 'Gerar novo código de recuperação' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Já guardei, continuar' }))

    expect(screen.getByRole('button', { name: 'Gerar novo código de recuperação' })).toBeInTheDocument()
    expect(screen.queryByText('FRESH-CODE-0000-1111')).not.toBeInTheDocument()
  })

  it('shows the wrong-password error inline and stays on the password form', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce({ code: 'INVALID_CREDENTIALS' })

    render(<RecoveryCodeRotateSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Gerar novo código de recuperação' }))
    await userEvent.type(screen.getByLabelText('Confirme sua senha atual'), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: 'Gerar novo código de recuperação' }))

    expect(await screen.findByText('Senha incorreta.')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirme sua senha atual')).toBeInTheDocument()
  })
})
