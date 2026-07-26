import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../i18n.ts'
import { AppLayout } from './AppLayout.tsx'
import * as useAuthModule from '../lib/useAuth.ts'

function mockLoadedStaff() {
  vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
    staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' },
    isLoadingStaff: false,
    isErrorStaff: false,
    refetchStaff: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    isLoggedIn: true,
  } as never)
}

// AppLayout renders at the app root, unconditionally calling this hook.
// A page-level layout test should never make a real network call, so the
// hook's own connection/retry behavior is covered by its dedicated test suite.
vi.mock('../features/products/useProductPhotoEvents.ts', () => ({
  useProductPhotoEvents: vi.fn(),
}))

describe('AppLayout', () => {
  it('caps the outer shell at the viewport height so main scrolls internally, not the page', () => {
    mockLoadedStaff()
    const queryClient = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/x']}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/x" element={<div>content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const shell = container.querySelector('.flex.h-screen')
    expect(shell).toBeInTheDocument()
    expect(container.querySelector('.flex.min-h-screen')).not.toBeInTheDocument()
  })

  it('does not put overflow-y-auto on main (pages own their own scroll region now)', () => {
    mockLoadedStaff()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><AppLayout /></MemoryRouter>
      </QueryClientProvider>,
    )
    const main = document.querySelector('main')
    expect(main?.className).not.toContain('overflow-y-auto')
    expect(main?.className).toContain('flex-1')
  })

  it('shows a loading state instead of the shell while the staff profile is still loading, to avoid flashing default branding', () => {
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      staff: undefined,
      isLoadingStaff: true,
      isErrorStaff: false,
      refetchStaff: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      isLoggedIn: true,
    } as never)
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><AppLayout /></MemoryRouter>
      </QueryClientProvider>,
    )
    expect(container.querySelector('nav')).not.toBeInTheDocument()
  })

  it('shows a retry/logout state instead of an infinite spinner when the staff profile fails to load', async () => {
    const refetchStaff = vi.fn()
    const logout = vi.fn()
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      staff: undefined,
      isLoadingStaff: false,
      isErrorStaff: true,
      refetchStaff,
      login: vi.fn(),
      logout,
      isLoggedIn: true,
    } as never)
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><AppLayout /></MemoryRouter>
      </QueryClientProvider>,
    )

    // Not the loading spinner, not the shell — a distinct, actionable state.
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument()
    expect(container.querySelector('nav')).not.toBeInTheDocument()

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)

    await userEvent.click(buttons[0])
    expect(refetchStaff).toHaveBeenCalledOnce()

    await userEvent.click(buttons[1])
    expect(logout).toHaveBeenCalledOnce()
  })

  it('shows the same retry/logout state if staff is unexpectedly absent with no loading and no error (defensive fallback)', () => {
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      staff: undefined,
      isLoadingStaff: false,
      isErrorStaff: false,
      refetchStaff: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      isLoggedIn: true,
    } as never)
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><AppLayout /></MemoryRouter>
      </QueryClientProvider>,
    )
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument()
    expect(container.querySelector('nav')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
})
