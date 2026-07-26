import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { CalendarPage } from './CalendarPage.tsx'
import * as useCalendarModule from './useCalendar.ts'
import * as useProductsModule from '../products/useProducts.ts'
import * as useClientsModule from '../clients/useClients.ts'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

function mockHooks() {
  vi.spyOn(useCalendarModule, 'useCalendarTab').mockReturnValue({ data: [], isLoading: false } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [], isLoading: false } as never)
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [], isLoading: false } as never)
}

function makeAllocation(overrides: Partial<Allocation> = {}): Allocation {
  return {
    id: 'alloc-1',
    productId: 'product-1',
    clientId: 'client-1',
    staffId: 'staff-1',
    checkoutDate: '2026-07-01T00:00:00.000Z',
    dueDate: '2026-07-10T00:00:00.000Z',
    actualReturnDate: null,
    status: 'checked_out',
    priceCharged: 100,
    depositCollected: null,
    depositReturned: null,
    conditionNotesOut: null,
    conditionNotesIn: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    locationId: 'location-1',
    name: 'Vestido Azul',
    category: 'dress',
    size: 'M',
    color: 'blue',
    rentalPrice: 100,
    depositAmount: 50,
    status: 'active',
    availability: 'available',
    hasAllocationHistory: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('CalendarPage', () => {
  it('defaults to the month view with the Saindo tab active', () => {
    mockHooks()
    render(<CalendarPage />)
    expect(screen.getByRole('button', { name: 'Ver agenda' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver mês' })).not.toBeInTheDocument()
  })

  it('toggles to agenda view and back', async () => {
    mockHooks()
    render(<CalendarPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Ver agenda' }))
    expect(screen.getByRole('button', { name: 'Ver mês' })).toBeInTheDocument()
  })

  it('renders the product name looked up from useProducts when the productId matches', () => {
    vi.spyOn(useCalendarModule, 'useCalendarTab').mockReturnValue({
      data: [makeAllocation({ productId: 'product-1' })],
      isLoading: false,
    } as never)
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({
      data: [makeProduct({ id: 'product-1', name: 'Vestido Azul' })],
      isLoading: false,
    } as never)
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [], isLoading: false } as never)

    render(<CalendarPage />)

    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.queryByText('product-1')).not.toBeInTheDocument()
  })

  it('falls back to the raw productId when no matching product is found', () => {
    vi.spyOn(useCalendarModule, 'useCalendarTab').mockReturnValue({
      data: [makeAllocation({ productId: 'unknown-product-id' })],
      isLoading: false,
    } as never)
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({
      data: [makeProduct({ id: 'product-1', name: 'Vestido Azul' })],
      isLoading: false,
    } as never)
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [], isLoading: false } as never)

    render(<CalendarPage />)

    expect(screen.getByText('unknown-product-id')).toBeInTheDocument()
    expect(screen.queryByText('Vestido Azul')).not.toBeInTheDocument()
  })
})
