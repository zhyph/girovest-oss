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
    })

    render(<DashboardPage />)

    expect(screen.getByText('Saindo hoje')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Atrasados')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
