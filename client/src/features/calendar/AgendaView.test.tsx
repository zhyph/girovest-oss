import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../i18n.ts'
import { AgendaView } from './AgendaView.tsx'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

function isoDateDaysFromNow(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

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

describe('AgendaView', () => {
  it('shows the empty message when there are no allocations', () => {
    render(<AgendaView allocations={[]} dateField="checkoutDate" products={products} clientNames={clientNames} />)
    expect(screen.getByText('Nada para mostrar neste período.')).toBeInTheDocument()
  })

  it('shows the client name alongside the product name', () => {
    render(
      <AgendaView
        allocations={[makeAllocation({ checkoutDate: isoDateDaysFromNow(0) })]}
        dateField="checkoutDate"
        products={products}
        clientNames={clientNames}
      />,
    )
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('Maria Silva')).toBeInTheDocument()
  })

  it('groups allocations into Hoje/Amanhã/Esta semana/Mais tarde/Atrasado', () => {
    render(
      <AgendaView
        allocations={[
          makeAllocation({ id: 'overdue', checkoutDate: isoDateDaysFromNow(-3) }),
          makeAllocation({ id: 'today', checkoutDate: isoDateDaysFromNow(0) }),
          makeAllocation({ id: 'tomorrow', checkoutDate: isoDateDaysFromNow(1) }),
          makeAllocation({ id: 'this-week', checkoutDate: isoDateDaysFromNow(4) }),
          makeAllocation({ id: 'later', checkoutDate: isoDateDaysFromNow(20) }),
        ]}
        dateField="checkoutDate"
        products={products}
        clientNames={clientNames}
      />,
    )

    expect(screen.getByText('Atrasado')).toBeInTheDocument()
    expect(screen.getByText('Hoje')).toBeInTheDocument()
    expect(screen.getByText('Amanhã')).toBeInTheDocument()
    expect(screen.getByText('Esta semana')).toBeInTheDocument()
    expect(screen.getByText('Mais tarde')).toBeInTheDocument()
  })

  it('omits group headers that have no allocations', () => {
    render(
      <AgendaView
        allocations={[makeAllocation({ checkoutDate: isoDateDaysFromNow(0) })]}
        dateField="checkoutDate"
        products={products}
        clientNames={clientNames}
      />,
    )
    expect(screen.getByText('Hoje')).toBeInTheDocument()
    expect(screen.queryByText('Amanhã')).not.toBeInTheDocument()
    expect(screen.queryByText('Esta semana')).not.toBeInTheDocument()
    expect(screen.queryByText('Mais tarde')).not.toBeInTheDocument()
    expect(screen.queryByText('Atrasado')).not.toBeInTheDocument()
  })

  it('paginates a single day-group that exceeds the page size', () => {
    const allocations = Array.from({ length: 25 }, (_, i) =>
      makeAllocation({ id: `a${i}`, checkoutDate: isoDateDaysFromNow(0) }),
    )
    render(<AgendaView allocations={allocations} dateField="checkoutDate" products={products} clientNames={clientNames} />)
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })
})
