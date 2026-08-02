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

// CalendarPage anchors MonthView on `new Date()` with no way to inject a
// fixed "today" from the test, and MonthView only renders events that fall
// within the visible month. Hardcoding a calendar month (e.g. July 2026)
// works only until the real clock moves past it, then the event silently
// falls outside the default view and these assertions time out looking for
// text that's still there — just off-screen. Anchoring to the current month
// instead keeps the fixture valid regardless of when the suite runs.
const now = new Date()
const currentMonthDay = (day: number) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00.000Z`

function makeAllocation(overrides: Partial<Allocation> = {}): Allocation {
  return {
    id: 'alloc-1',
    productId: 'product-1',
    clientId: 'client-1',
    staffId: 'staff-1',
    checkoutDate: currentMonthDay(1),
    actualCheckoutDate: null,
    dueDate: currentMonthDay(10),
    actualReturnDate: null,
    status: 'checked_out',
    priceCharged: 100,
    depositCollected: null,
    depositReturned: null,
    conditionNotesOut: null,
    conditionNotesIn: null,
    createdAt: currentMonthDay(1),
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

  it(
    'renders the lazy month grid by default, toggles to agenda and back',
    async () => {
      mockHooks()
      render(<CalendarPage />)
      // Month is now the default view and MonthView is lazy-loaded — wait
      // for its chunk to resolve and render react-big-calendar's toolbar
      // through the Suspense boundary, instead of only asserting on
      // CalendarPage's own toggle button (which flips regardless of whether
      // MonthView mounted). The generous timeout is for transforming
      // react-big-calendar's module graph on first import under Vitest, not
      // for the dynamic import itself.
      //
      // Raised from 9s after the suite grew: this transform takes ~4.7s on an
      // idle machine and several times that when the full suite is competing
      // for CPU, so the old budget failed as soon as enough files ran in
      // parallel. The real fix is prebundling react-big-calendar via Vitest's
      // dep optimizer so the cost falls outside the timed assertion; until then
      // the budget has to cover the worst case, and the cost of a large timeout
      // is only paid when the test is actually about to fail.
      expect(await screen.findByRole('button', { name: 'Hoje' }, { timeout: 30000 })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Ver agenda' }))
      expect(screen.getByRole('button', { name: 'Ver mês' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Hoje' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Ver mês' }))
      expect(await screen.findByRole('button', { name: 'Hoje' }, { timeout: 30000 })).toBeInTheDocument()
    },
    45000,
  )

  it('renders the product name looked up from useProducts when the productId matches', async () => {
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

    // MonthView (the default view) is lazy-loaded behind a Suspense boundary,
    // so its content — where the product name actually renders — is not in
    // the DOM on the synchronous first render. findByText waits for the
    // chunk's Suspense fallback to resolve instead of asserting too early.
    expect(await screen.findByText('Vestido Azul', {}, { timeout: 30000 })).toBeInTheDocument()
    expect(screen.queryByText('product-1')).not.toBeInTheDocument()
  }, 45000)

  it('falls back to the raw productId when no matching product is found', async () => {
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

    expect(await screen.findByText('unknown-product-id', {}, { timeout: 30000 })).toBeInTheDocument()
    expect(screen.queryByText('Vestido Azul')).not.toBeInTheDocument()
  }, 45000)
})
