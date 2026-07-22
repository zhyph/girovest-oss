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
    expect(screen.getByText('Ana Owner').closest('div')?.parentElement).toHaveClass('border-t')
  })

  it('hides nav labels and the staff name behind a hidden/group-hover span, not just overflow clipping', () => {
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

    expect(screen.getByText('Painel').tagName).toBe('SPAN')
    expect(screen.getByText('Painel')).toHaveClass('hidden', 'group-hover:inline', 'group-focus-within:inline', 'lg:inline')
    expect(screen.getByText('Ana Owner')).toHaveClass('hidden', 'group-hover:inline', 'group-focus-within:inline', 'lg:inline')
  })
})
