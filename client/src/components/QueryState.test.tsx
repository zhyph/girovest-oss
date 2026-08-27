import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../i18n.ts'
import { QueryState } from './QueryState.tsx'

function renderState(props: Partial<React.ComponentProps<typeof QueryState>> = {}) {
  return render(
    <QueryState isLoading={false} isError={false} onRetry={vi.fn()} {...props}>
      <p>conteúdo</p>
    </QueryState>,
  )
}

describe('QueryState', () => {
  it('renders its children once the query has settled with data', () => {
    renderState()
    expect(screen.getByText('conteúdo')).toBeInTheDocument()
  })

  it('shows a loading line instead of the children while loading', () => {
    renderState({ isLoading: true })
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument()
    expect(screen.getByText('Carregando...')).toBeInTheDocument()
  })

  it('CRITICAL: a failed query is an error with a way out, never an empty screen', () => {
    // The defect this exists for: screens destructured only `isLoading` and
    // `data`, so `data ?? []` rendered "nenhum resultado" for a server that
    // was down. She had no way to tell, and no control to try again.
    renderState({ isError: true })

    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
  })

  it('retries the query when the control is pressed', async () => {
    const onRetry = vi.fn()
    renderState({ isError: true, onRetry })

    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('reports a failure even while a sibling query is still loading', () => {
    // Reachable through the multi-query callers — CalendarPage and
    // useDashboard OR several queries together, so one can be pending while
    // another has already failed. Announcing "loading" there hides a failure
    // that is not going to resolve itself.
    renderState({ isError: true, isLoading: true })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Carregando...')).not.toBeInTheDocument()
  })

  it('CRITICAL: a failed refresh does not wipe data that is already on screen', () => {
    // TanStack sets status:'error' unconditionally and leaves `data` intact,
    // so isError is equally true for "never loaded" and "reloaded and the
    // reload failed". The app runs on a bare QueryClient (staleTime 0,
    // refetchOnWindowFocus), so every alt-tab refetches these screens — and
    // blanking on isError alone wiped a good 300-client list on one hiccup,
    // which is worse than the empty-state bug this component exists to fix.
    renderState({ isError: true, hasData: true })

    expect(screen.getByText('conteúdo')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
  })

  it('still replaces the screen when the failure is a failed LOAD', () => {
    renderState({ isError: true, hasData: false })
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument()
  })

  it('uses screen-specific error copy when given it', () => {
    renderState({ isError: true, errorMessage: 'Não foi possível carregar este contrato.' })
    expect(screen.getByText('Não foi possível carregar este contrato.')).toBeInTheDocument()
  })
})
