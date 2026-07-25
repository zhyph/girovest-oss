import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from './AppLayout.tsx'

// AppLayout renders at the app root, unconditionally calling this hook.
// A page-level layout test should never make a real network call, so the
// hook's own connection/retry behavior is covered by its dedicated test suite.
vi.mock('../features/products/useProductPhotoEvents.ts', () => ({
  useProductPhotoEvents: vi.fn(),
}))

describe('AppLayout', () => {
  it('caps the outer shell at the viewport height so main scrolls internally, not the page', () => {
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
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><AppLayout /></MemoryRouter>
      </QueryClientProvider>,
    )
    const main = document.querySelector('main')
    expect(main?.className).not.toContain('overflow-y-auto')
    expect(main?.className).toContain('flex-1')
  })
})
