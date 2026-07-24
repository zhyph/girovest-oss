import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { CalendarDayItemsList } from './CalendarDayItemsList.tsx'
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
    rentalPrice: 250, depositAmount: 150, photos: ['https://example.com/a.jpg'],
    status: 'active', availability: 'available', hasAllocationHistory: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

const products = new Map([['p1', makeProduct()]])
const clientNames = new Map([['c1', 'Maria Silva']])

describe('CalendarDayItemsList', () => {
  it('renders a thumbnail, product name, client name and date for each row', () => {
    render(
      <CalendarDayItemsList
        allocations={[makeAllocation()]}
        products={products}
        clientNames={clientNames}
        dateField="checkoutDate"
      />,
    )
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('Maria Silva')).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/a.jpg')
  })

  it('falls back to the product name with no image when a product has no photos', () => {
    const noPhotoProducts = new Map([['p1', makeProduct({ photos: [] })]])
    render(
      <CalendarDayItemsList
        allocations={[makeAllocation()]}
        products={noPhotoProducts}
        clientNames={clientNames}
        dateField="checkoutDate"
      />,
    )
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('paginates at the given page size and Next/Previous move between pages', async () => {
    const allocations = Array.from({ length: 25 }, (_, i) =>
      makeAllocation({ id: `a${i}`, checkoutDate: `2026-07-${String((i % 27) + 1).padStart(2, '0')}` }),
    )
    render(
      <CalendarDayItemsList
        allocations={allocations}
        products={products}
        clientNames={clientNames}
        dateField="checkoutDate"
        pageSize={10}
      />,
    )

    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getAllByText('Vestido Azul')).toHaveLength(10)

    await userEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('opens ProductDetailModal with the right product when a row is clicked', async () => {
    render(
      <CalendarDayItemsList
        allocations={[makeAllocation()]}
        products={products}
        clientNames={clientNames}
        dateField="checkoutDate"
      />,
    )
    await userEvent.click(screen.getByText('Vestido Azul'))
    expect(screen.getByText('festa')).toBeInTheDocument()
  })
})
