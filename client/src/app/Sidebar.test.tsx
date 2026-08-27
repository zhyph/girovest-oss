import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import '../i18n.ts'
import { Sidebar } from './Sidebar.tsx'
import * as useAuthModule from '../lib/useAuth.ts'

function mockLoadedStaff() {
  vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
    staff: { id: '1', name: 'Ana Owner', login: 'lojista', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' },
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

// Surfaces the router's current URL so a navigation triggered by the rail
// can be asserted on directly, rather than inferred from a spy.
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
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

  it('renders the shop name once, with the product name as the quieter second line', () => {
    mockLoadedStaff()

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    // The rail's two lines must say different things. The brand line
    // already falls back to the location name, so rendering the location
    // again underneath would print the same string twice.
    const rail = screen.getByRole('navigation')
    expect(within(rail).getAllByText('Loja Teste')).toHaveLength(1)
    expect(within(rail).getByText('Girovest')).toBeInTheDocument()
  })

  it('navigates to the new-contract form from the rail shortcut', async () => {
    mockLoadedStaff()

    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
        <LocationProbe />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('location')).toHaveTextContent('/')

    await userEvent.click(screen.getByRole('button', { name: 'Nova alocação' }))

    // The deep link is what opens the dialog on the contracts screen, so
    // the query param — not just the path — is the load-bearing part.
    expect(screen.getByTestId('location')).toHaveTextContent('/contratos?novo=1')
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
    // findBy, not getBy: the drawer is a Radix portal, so it is not
    // guaranteed to be in the document on the tick the click resolves. A
    // synchronous assertion here passes on an idle machine and fails
    // intermittently once enough test files run in parallel.
    expect(await screen.findByRole('dialog', { name: 'Loja Teste' })).toBeInTheDocument()
    // Raised from the 5s default: opening a Radix portal through
    // userEvent's pointer simulation costs far more wall-clock when the
    // whole suite is competing for CPU than it does on an idle machine,
    // and this test began timing out (not failing an assertion) once the
    // file count grew. Same reasoning as the budgets in CalendarPage.test.
  }, 20000)

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
