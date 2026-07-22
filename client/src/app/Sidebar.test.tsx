import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../i18n.ts'
import { Sidebar } from './Sidebar.tsx'
import * as useAuthModule from '../lib/useAuth.ts'

describe('Sidebar', () => {
  it('shows the nav links and the logged-in staff name', () => {
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      staff: { id: '1', name: 'Ana Owner', role: 'owner', locationId: 'l1', locationName: 'Loja Teste' },
      isLoadingStaff: false,
      login: vi.fn(),
      logout: vi.fn(),
      isLoggedIn: true,
    })

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Painel' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clientes' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Produtos' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Alocações' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Calendário' })).toBeInTheDocument()
    expect(screen.getByText('Ana Owner')).toBeInTheDocument()
  })
})
