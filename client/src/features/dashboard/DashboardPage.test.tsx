import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../i18n.ts'
import { DashboardPage } from './DashboardPage.tsx'
import * as useDashboardModule from './useDashboard.ts'
import * as useProductsModule from '../products/useProducts.ts'
import * as useClientsModule from '../clients/useClients.ts'

function mockProductsAndClients() {
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [], isLoading: false } as never)
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [], isLoading: false } as never)
}

describe('DashboardPage', () => {
  it('shows the three today counts', async () => {
    mockProductsAndClients()
    vi.spyOn(useDashboardModule, 'useDashboard').mockReturnValue({
      goingOutToday: [{ id: '1' }] as never,
      dueBackToday: [] as never,
      overdue: [{ id: '2' }, { id: '3' }] as never,
      upcoming: [] as never,
      isLoading: false,
      isError: false,
    })

    render(<DashboardPage />)

    expect(screen.getByText('Saindo hoje')).toBeInTheDocument()
    // Stat values render via CountUp, an animated counter (spring-based, not
    // instant) — findByText retries until the animation settles on 1/2.
    expect(await screen.findByText('1')).toBeInTheDocument()
    expect(screen.getByText('Atrasados')).toBeInTheDocument()
    expect(await screen.findByText('2')).toBeInTheDocument()
  })

  it('shows loading message when isLoading is true', () => {
    mockProductsAndClients()
    vi.spyOn(useDashboardModule, 'useDashboard').mockReturnValue({
      goingOutToday: [] as never,
      dueBackToday: [] as never,
      overdue: [] as never,
      upcoming: [] as never,
      isLoading: true,
      isError: false,
    })

    render(<DashboardPage />)

    expect(screen.getByText('Carregando...')).toBeInTheDocument()
    expect(screen.queryByText('Saindo hoje')).not.toBeInTheDocument()
    expect(screen.queryByText('Voltando hoje')).not.toBeInTheDocument()
    expect(screen.queryByText('Atrasados')).not.toBeInTheDocument()
  })

  it('shows error message when isError is true', () => {
    mockProductsAndClients()
    vi.spyOn(useDashboardModule, 'useDashboard').mockReturnValue({
      goingOutToday: [] as never,
      dueBackToday: [] as never,
      overdue: [] as never,
      upcoming: [] as never,
      isLoading: false,
      isError: true,
    })

    render(<DashboardPage />)

    expect(screen.getByText('Erro ao carregar dados do painel. Tente novamente.')).toBeInTheDocument()
    expect(screen.queryByText('Saindo hoje')).not.toBeInTheDocument()
    expect(screen.queryByText('Voltando hoje')).not.toBeInTheDocument()
    expect(screen.queryByText('Atrasados')).not.toBeInTheDocument()
  })

  it('shows the upcoming allocations list with product and client names', () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({
      data: [{ id: 'p1', name: 'Vestido Azul' }], isLoading: false,
    } as never)
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [{ id: 'c1', name: 'Maria Silva' }], isLoading: false,
    } as never)
    vi.spyOn(useDashboardModule, 'useDashboard').mockReturnValue({
      goingOutToday: [] as never,
      dueBackToday: [] as never,
      overdue: [] as never,
      upcoming: [{ id: 'a1', productId: 'p1', clientId: 'c1', checkoutDate: '2026-07-25', dueDate: '2026-07-30', status: 'reserved' }] as never,
      isLoading: false,
      isError: false,
    })

    render(<DashboardPage />)

    expect(screen.getByText('Próximas alocações')).toBeInTheDocument()
    expect(screen.getByText('Vestido Azul — Maria Silva')).toBeInTheDocument()
  })

  it('shows the empty-upcoming message when there is nothing scheduled', () => {
    mockProductsAndClients()
    vi.spyOn(useDashboardModule, 'useDashboard').mockReturnValue({
      goingOutToday: [] as never,
      dueBackToday: [] as never,
      overdue: [] as never,
      upcoming: [] as never,
      isLoading: false,
      isError: false,
    })

    render(<DashboardPage />)

    expect(screen.getByText('Nada programado para os próximos dias.')).toBeInTheDocument()
  })
})
