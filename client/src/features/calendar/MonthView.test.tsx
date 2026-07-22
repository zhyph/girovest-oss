import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MonthView } from './MonthView.tsx'

describe('MonthView', () => {
  it('renders the toolbar in pt-BR instead of the react-big-calendar English default', () => {
    render(
      <MonthView
        allocations={[]}
        dateField="checkoutDate"
        onSelectDay={vi.fn()}
        productNames={new Map()}
        date={new Date(2026, 6, 22)}
        onNavigate={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Hoje' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument()
  })

  it('jumps to the agenda view when a day number is clicked (onDrillDown, not just empty-cell onSelectSlot)', async () => {
    const onSelectDay = vi.fn()
    render(
      <MonthView
        allocations={[]}
        dateField="checkoutDate"
        onSelectDay={onSelectDay}
        productNames={new Map()}
        date={new Date(2026, 6, 22)}
        onNavigate={vi.fn()}
      />,
    )

    const dayLink = document.querySelector('.rbc-button-link') as HTMLElement
    expect(dayLink).toBeTruthy()
    dayLink.click()

    expect(onSelectDay).toHaveBeenCalledTimes(1)
    expect(onSelectDay.mock.calls[0][0]).toBeInstanceOf(Date)
  })
})
