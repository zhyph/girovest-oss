import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../i18n.ts'
import { DashboardPage } from './DashboardPage.tsx'
import * as useDashboardModule from './useDashboard.ts'
import * as useProductsModule from '../products/useProducts.ts'
import * as useClientsModule from '../clients/useClients.ts'

function mockProductsAndClients() {
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [], isLoading: false } as never)
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [], isLoading: false } as never)
}

function renderDashboard() {
  return render(<DashboardPage />, { wrapper: MemoryRouter })
}

describe('DashboardPage', () => {
  it('scrolls the upcoming list internally instead of the whole page', () => {
    mockProductsAndClients()
    vi.spyOn(useDashboardModule, 'useDashboard').mockReturnValue({
      goingOutToday: [] as never,
      dueBackToday: [] as never,
      overdue: [] as never,
      upcoming: [] as never,
      receivablesThisWeek: { total: 0, count: 0 },
      leavingMaintenance: { count: 0, items: [] },
      isLoading: false,
      isError: false,
    })

    const { container } = renderDashboard()
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('min-h-0')

    const scrollRegion = container.querySelector('.overflow-y-auto')
    expect(scrollRegion).not.toBeNull()

    const statGrid = container.querySelector('.grid.grid-cols-4')
    expect(statGrid).not.toBeNull()

    // The stat tiles must be pinned outside the scroll region, not nested
    // inside it — a regression here would re-scroll the tiles along with
    // the list, which is exactly the bug this test guards against.
    expect(statGrid).not.toBe(scrollRegion)
    expect(scrollRegion!.contains(statGrid)).toBe(false)
  })

  it('shows the three today counts', async () => {
    mockProductsAndClients()
    vi.spyOn(useDashboardModule, 'useDashboard').mockReturnValue({
      goingOutToday: [{ id: '1' }] as never,
      dueBackToday: [] as never,
      overdue: [{ id: '2' }, { id: '3' }] as never,
      upcoming: [] as never,
      receivablesThisWeek: { total: 0, count: 0 },
      leavingMaintenance: { count: 0, items: [] },
      isLoading: false,
      isError: false,
    })

    renderDashboard()

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
      receivablesThisWeek: { total: 0, count: 0 },
      leavingMaintenance: { count: 0, items: [] },
      isLoading: true,
      isError: false,
    })

    renderDashboard()

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
      receivablesThisWeek: { total: 0, count: 0 },
      leavingMaintenance: { count: 0, items: [] },
      isLoading: false,
      isError: true,
    })

    renderDashboard()

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
      receivablesThisWeek: { total: 0, count: 0 },
      leavingMaintenance: { count: 0, items: [] },
      isLoading: false,
      isError: false,
    })

    renderDashboard()

    expect(screen.getByText('Próximas alocações')).toBeInTheDocument()
    // The piece and the client are now separate lines rather than one
    // run-on string: the product name is what identifies the row, and the
    // client is the quieter second line under it.
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('Maria Silva')).toBeInTheDocument()
  })

  it('shows the empty-upcoming message when there is nothing scheduled', () => {
    mockProductsAndClients()
    vi.spyOn(useDashboardModule, 'useDashboard').mockReturnValue({
      goingOutToday: [] as never,
      dueBackToday: [] as never,
      overdue: [] as never,
      upcoming: [] as never,
      receivablesThisWeek: { total: 0, count: 0 },
      leavingMaintenance: { count: 0, items: [] },
      isLoading: false,
      isError: false,
    })

    renderDashboard()

    expect(screen.getByText('Nada programado para os próximos dias.')).toBeInTheDocument()
  })

  it('shows the week\'s receivables as money, not as a count', () => {
    mockProductsAndClients()
    vi.spyOn(useDashboardModule, 'useDashboard').mockReturnValue({
      goingOutToday: [] as never,
      dueBackToday: [] as never,
      overdue: [] as never,
      upcoming: [] as never,
      receivablesThisWeek: { total: 4280.5, count: 3 },
      leavingMaintenance: { count: 0, items: [] },
      isLoading: false,
      isError: false,
    })

    renderDashboard()

    expect(screen.getByText('A receber esta semana')).toBeInTheDocument()
    // The formatted total, not the installment count — a tile reading "3"
    // here would be the regression this guards against.
    expect(screen.getByText(/4\.280,50/)).toBeInTheDocument()
    expect(screen.queryByText('3')).not.toBeInTheDocument()
  })

  it('lists the pieces leaving the cleaning window and when they free up', () => {
    mockProductsAndClients()
    vi.spyOn(useDashboardModule, 'useDashboard').mockReturnValue({
      goingOutToday: [] as never,
      dueBackToday: [] as never,
      overdue: [] as never,
      upcoming: [] as never,
      receivablesThisWeek: { total: 0, count: 0 },
      leavingMaintenance: { count: 1, items: [{ id: 'p9', name: 'Vestido Longo', availableOn: '2026-08-06' }] },
      isLoading: false,
      isError: false,
    })

    renderDashboard()

    expect(screen.getByText('Saindo da higienização')).toBeInTheDocument()
    expect(screen.getByText('Vestido Longo')).toBeInTheDocument()
    expect(screen.getByText('06/08')).toBeInTheDocument()
  })

  it('shows the empty cleaning-window message when nothing is coming back', () => {
    mockProductsAndClients()
    vi.spyOn(useDashboardModule, 'useDashboard').mockReturnValue({
      goingOutToday: [] as never,
      dueBackToday: [] as never,
      overdue: [] as never,
      upcoming: [] as never,
      receivablesThisWeek: { total: 0, count: 0 },
      leavingMaintenance: { count: 0, items: [] },
      isLoading: false,
      isError: false,
    })

    renderDashboard()

    expect(screen.getByText('Nenhuma peça sai da higienização nos próximos dias.')).toBeInTheDocument()
  })
})
