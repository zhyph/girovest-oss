import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from './AppLayout.tsx'

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
})
