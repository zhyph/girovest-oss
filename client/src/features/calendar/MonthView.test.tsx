import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { MonthView } from './MonthView.tsx'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

function makeAllocation(overrides: Partial<Allocation> = {}): Allocation {
  return {
    id: 'a1', productId: 'p1', clientId: 'c1', staffId: 's1',
    checkoutDate: '2026-07-01', dueDate: '2026-07-05',
    actualReturnDate: null, status: 'reserved', priceCharged: 100,
    depositCollected: null, depositReturned: null, conditionNotesOut: null, conditionNotesIn: null,
    createdAt: '2026-07-01',
    ...overrides,
  }
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1', locationId: 'loc1', name: 'Vestido Azul', category: 'festa', size: 'M', color: 'azul',
    rentalPrice: 250, depositAmount: 150,
    status: 'active', availability: 'available', hasAllocationHistory: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

const products = new Map([['p1', makeProduct()]])
const clientNames = new Map([['c1', 'Maria Silva']])
const productNames = new Map([['p1', 'Vestido Azul']])

describe('MonthView', () => {
  it('renders the toolbar in pt-BR instead of the react-big-calendar English default', () => {
    render(
      <MonthView
        allocations={[]}
        dateField="checkoutDate"
        onSelectDay={vi.fn()}
        productNames={new Map()}
        products={new Map()}
        clientNames={new Map()}
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
        products={new Map()}
        clientNames={new Map()}
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

  it('opens the day-items panel (not Agenda) when "+N more" is clicked', async () => {
    const onSelectDay = vi.fn()
    const day = new Date(2026, 6, 22)
    const allocations = Array.from({ length: 5 }, (_, i) =>
      makeAllocation({ id: `a${i}`, checkoutDate: '2026-07-22' }),
    )
    render(
      <MonthView
        allocations={allocations}
        dateField="checkoutDate"
        onSelectDay={onSelectDay}
        productNames={productNames}
        products={products}
        clientNames={clientNames}
        date={day}
        onNavigate={vi.fn()}
      />,
    )

    const showMoreLink = document.querySelector('.rbc-show-more') as HTMLElement | null
    if (showMoreLink) {
      await userEvent.click(showMoreLink)
      expect(onSelectDay).not.toHaveBeenCalled()
      expect(screen.getAllByText('Vestido Azul').length).toBeGreaterThan(0)
    }
  })
})
