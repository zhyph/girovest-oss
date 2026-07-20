import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { LoginPage } from './LoginPage.tsx'
import * as useAuthModule from '../../lib/useAuth.ts'

describe('LoginPage', () => {
  it('submits the entered credentials to login()', async () => {
    const login = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      staff: undefined, isLoadingStaff: false, login, logout: vi.fn(), isLoggedIn: false,
    })

    render(<LoginPage />)
    await userEvent.type(screen.getByLabelText('Usuário'), 'ana')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha123')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(login).toHaveBeenCalledWith('ana', 'senha123')
  })

  it('shows a translated error message when login rejects', async () => {
    const login = vi.fn().mockRejectedValue({ code: 'INVALID_CREDENTIALS', message: 'nope' })
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      staff: undefined, isLoadingStaff: false, login, logout: vi.fn(), isLoggedIn: false,
    })

    render(<LoginPage />)
    await userEvent.type(screen.getByLabelText('Usuário'), 'ana')
    await userEvent.type(screen.getByLabelText('Senha'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByText('Usuário ou senha inválidos.')).toBeInTheDocument()
  })
})
