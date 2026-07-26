import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import '../i18n.ts'
import { Sidebar } from './Sidebar.tsx'
import * as useAuthModule from '../lib/useAuth.ts'

function mockLoadedStaff() {
  vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
    staff: { id: '1', name: 'Ana Owner', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' },
    isLoadingStaff: false,
    isErrorStaff: false,
    refetchStaff: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    isLoggedIn: true,
  })
}

// jsdom doesn't implement matchMedia at all. Returns a stub whose 'change'
// listeners the test can fire directly, standing in for a real viewport
// resize or tablet rotation crossing the desktop breakpoint.
function mockMatchMedia() {
  const listeners: Array<(event: MediaQueryListEvent) => void> = []
  const mediaQueryList = {
    matches: false,
    media: '',
    addEventListener: vi.fn((_event: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.push(cb)
    }),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mediaQueryList))
  return {
    fireDesktopBreakpointCrossed: () => {
      listeners.forEach((cb) => cb({ matches: true } as MediaQueryListEvent))
    },
  }
}

describe('Sidebar', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the nav links and the logged-in staff name', () => {
    mockLoadedStaff()

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Painel' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clientes' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Produtos' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Contratos' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Calendário' })).toBeInTheDocument()
    expect(screen.getByText('Ana Owner')).toBeInTheDocument()
    expect(screen.getByText('Ana Owner').closest('div')?.parentElement).toHaveClass('border-t')
  })

  it('hides nav labels and the staff name behind a hidden/group-hover span, not just overflow clipping', () => {
    mockLoadedStaff()

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    expect(screen.getByText('Painel').tagName).toBe('SPAN')
    expect(screen.getByText('Painel')).toHaveClass('hidden', 'group-hover:inline', 'group-focus-within:inline', 'lg:inline')
    expect(screen.getByText('Ana Owner')).toHaveClass('hidden', 'group-hover:inline', 'group-focus-within:inline', 'lg:inline')
  })

  it('opens the mobile drawer via the hamburger button', async () => {
    mockLoadedStaff()

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Abrir menu' }))
    expect(screen.getByRole('dialog', { name: 'Loja Teste' })).toBeInTheDocument()
  })

  it('closes the mobile drawer when the viewport crosses into the desktop breakpoint while it is open', async () => {
    mockLoadedStaff()
    const { fireDesktopBreakpointCrossed } = mockMatchMedia()

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Abrir menu' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireDesktopBreakpointCrossed()

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
