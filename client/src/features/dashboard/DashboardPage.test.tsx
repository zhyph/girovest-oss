import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../i18n.ts'
import { DashboardPage } from './DashboardPage.tsx'
import * as useDashboardModule from './useDashboard.ts'

describe('DashboardPage', () => {
  it('shows the three today counts', () => {
    vi.spyOn(useDashboardModule, 'useDashboard').mockReturnValue({
      goingOutToday: [{ id: '1' }] as never,
      dueBackToday: [] as never,
      overdue: [{ id: '2' }, { id: '3' }] as never,
      isLoading: false,
      isError: false,
    })

    render(<DashboardPage />)

    expect(screen.getByText('Saindo hoje')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Atrasados')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('shows loading message when isLoading is true', () => {
    vi.spyOn(useDashboardModule, 'useDashboard').mockReturnValue({
      goingOutToday: [] as never,
      dueBackToday: [] as never,
      overdue: [] as never,
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
    vi.spyOn(useDashboardModule, 'useDashboard').mockReturnValue({
      goingOutToday: [] as never,
      dueBackToday: [] as never,
      overdue: [] as never,
      isLoading: false,
      isError: true,
    })

    render(<DashboardPage />)

    expect(screen.getByText('Erro ao carregar dados do painel. Tente novamente.')).toBeInTheDocument()
    expect(screen.queryByText('Saindo hoje')).not.toBeInTheDocument()
    expect(screen.queryByText('Voltando hoje')).not.toBeInTheDocument()
    expect(screen.queryByText('Atrasados')).not.toBeInTheDocument()
  })
})
