import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { CalendarPage } from './CalendarPage.tsx'
import * as useCalendarModule from './useCalendar.ts'
import * as useProductsModule from '../products/useProducts.ts'

function mockHooks() {
  vi.spyOn(useCalendarModule, 'useCalendarTab').mockReturnValue({ data: [], isLoading: false } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [], isLoading: false } as never)
}

describe('CalendarPage', () => {
  it('defaults to the agenda view with the Saindo tab active', () => {
    mockHooks()
    render(<CalendarPage />)
    expect(screen.getByRole('button', { name: 'Ver mês' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver agenda' })).not.toBeInTheDocument()
  })

  it('toggles to month view and back', async () => {
    mockHooks()
    render(<CalendarPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Ver mês' }))
    expect(screen.getByRole('button', { name: 'Ver agenda' })).toBeInTheDocument()
  })
})
