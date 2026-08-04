import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import '../../i18n.ts'
import { CalendarDayItemsList } from './CalendarDayItemsList.tsx'
import { buildEntries, type CalendarEntry } from './calendarEntries.ts'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

function makeAllocation(overrides: Partial<Allocation> = {}): Allocation {
  return {
    id: 'a1', productId: 'p1', clientId: 'c1', staffId: 's1',
    checkoutDate: '2026-07-01', actualCheckoutDate: null, dueDate: '2026-07-05',
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
    status: 'active', availability: 'available', code: 1, hasAllocationHistory: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

// The list is handed entries, not raw allocations: each row carries the day
// it belongs to, so one list can mix pieces going out with pieces coming back.
function outEntries(...allocations: Allocation[]): CalendarEntry[] {
  return buildEntries({ 'going-out': allocations, 'due-back': [], overdue: [] }, 'going-out')
}

const products = new Map([['p1', makeProduct()]])
const clientNames = new Map([['c1', 'Maria Silva']])

describe('CalendarDayItemsList', () => {
  it('renders a thumbnail, product name, client name and date for each row', () => {
    render(
      <CalendarDayItemsList
        entries={outEntries(makeAllocation())}
        products={products}
        clientNames={clientNames}
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
        entries={outEntries(makeAllocation())}
        products={noPhotoProducts}
        clientNames={clientNames}
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
        entries={outEntries(...allocations)}
        products={products}
        clientNames={clientNames}
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

  it('opens the photo zoom panel with the right product when a row is clicked', async () => {
    // MemoryRouter: the zoom's "Abrir ficha do produto" routes to Produtos.
    render(
      <MemoryRouter>
        <CalendarDayItemsList
          entries={outEntries(makeAllocation())}
          products={products}
          clientNames={clientNames}
        />
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByText('Vestido Azul'))
    expect(screen.getByText('festa')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir ficha do produto' })).toBeInTheDocument()
  })

  it('renders without crashing and hides pagination controls when there are no allocations', () => {
    render(
      <CalendarDayItemsList
        entries={outEntries()}
        products={products}
        clientNames={clientNames}
        pageSize={10}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Próximo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Anterior' })).not.toBeInTheDocument()
  })

  it('does not show a phantom empty page when allocations are an exact multiple of pageSize', async () => {
    const allocations = Array.from({ length: 20 }, (_, i) =>
      makeAllocation({ id: `a${i}`, checkoutDate: `2026-07-${String((i % 27) + 1).padStart(2, '0')}` }),
    )
    render(
      <CalendarDayItemsList
        entries={outEntries(...allocations)}
        products={products}
        clientNames={clientNames}
        pageSize={10}
      />,
    )

    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    const nextButton = screen.getByRole('button', { name: 'Próximo' })
    expect(nextButton).not.toBeDisabled()

    await userEvent.click(nextButton)
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(screen.getAllByText('Vestido Azul')).toHaveLength(10)
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeDisabled()
  })

  it('falls back to the raw productId and does not open the modal when the product is missing from the map', async () => {
    const emptyProducts = new Map<string, Product>()
    render(
      <CalendarDayItemsList
        entries={outEntries(makeAllocation({ productId: 'missing-product' }))}
        products={emptyProducts}
        clientNames={clientNames}
      />,
    )
    expect(screen.getByText('missing-product')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('missing-product'))
    expect(screen.queryByText('festa')).not.toBeInTheDocument()
  })

  it('clamps to a valid page when a shorter allocations array is passed to the same instance', async () => {
    const manyAllocations = Array.from({ length: 25 }, (_, i) =>
      makeAllocation({ id: `a${i}`, checkoutDate: `2026-07-${String((i % 27) + 1).padStart(2, '0')}` }),
    )
    const { rerender } = render(
      <CalendarDayItemsList
        entries={outEntries(...manyAllocations)}
        products={products}
        clientNames={clientNames}
        pageSize={10}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    expect(screen.getByText('3 / 3')).toBeInTheDocument()

    const fewAllocations = [makeAllocation({ id: 'only', checkoutDate: '2026-07-10' })]
    rerender(
      <CalendarDayItemsList
        entries={outEntries(...fewAllocations)}
        products={products}
        clientNames={clientNames}
        pageSize={10}
      />,
    )

    expect(screen.getAllByText('Vestido Azul')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Próximo' })).not.toBeInTheDocument()
  })

  it('moves back immediately on the first click when totalPages shrinks while parked on the last page', async () => {
    const manyAllocations = Array.from({ length: 25 }, (_, i) =>
      makeAllocation({ id: `a${i}`, checkoutDate: `2026-07-${String((i % 27) + 1).padStart(2, '0')}` }),
    )
    const { rerender } = render(
      <CalendarDayItemsList
        entries={outEntries(...manyAllocations)}
        products={products}
        clientNames={clientNames}
        pageSize={10}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    expect(screen.getByText('3 / 3')).toBeInTheDocument()

    const fewerAllocations = Array.from({ length: 15 }, (_, i) =>
      makeAllocation({ id: `b${i}`, checkoutDate: `2026-07-${String((i % 27) + 1).padStart(2, '0')}` }),
    )
    rerender(
      <CalendarDayItemsList
        entries={outEntries(...fewerAllocations)}
        products={products}
        clientNames={clientNames}
        pageSize={10}
      />,
    )
    expect(screen.getByText('2 / 2')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })
})
