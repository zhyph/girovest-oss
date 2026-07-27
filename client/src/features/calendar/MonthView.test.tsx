import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { MonthView } from './MonthView.tsx'
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
    rentalPrice: 250, depositAmount: 150,
    status: 'active', availability: 'available', hasAllocationHistory: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

const products = new Map([['p1', makeProduct()]])
const clientNames = new Map([['c1', 'Maria Silva']])
const productNames = new Map([['p1', 'Vestido Azul']])

// jsdom has no layout engine, so every getBoundingClientRect() reports zeroes.
// react-big-calendar sizes a month cell by dividing the row height by the event
// height (DateContentRow.getRowLimit), which with zeroes yields NaN — so it
// renders every event and the "+N more" overflow button is never created at
// all. Reporting one uniform non-zero height collapses the row limit to 1,
// which is what makes the overflow button exist here. Deliberately scoped to
// this file rather than setupTests.ts: a global layout stub would change Radix
// popover/dialog positioning in every other test file.
function mockLayoutHeights() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  )
}

// Five allocations on the same day: with a row limit of 1, one renders and the
// other four collapse into the overflow button.
function sameDayAllocations() {
  return Array.from({ length: 5 }, (_, i) => makeAllocation({ id: `a${i}`, checkoutDate: '2026-07-22' }))
}

describe('MonthView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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
    mockLayoutHeights()
    const onSelectDay = vi.fn()
    render(
      <MonthView
        allocations={sameDayAllocations()}
        dateField="checkoutDate"
        onSelectDay={onSelectDay}
        productNames={productNames}
        products={products}
        clientNames={clientNames}
        date={new Date(2026, 6, 22)}
        onNavigate={vi.fn()}
      />,
    )

    const showMoreLink = screen.getByRole('button', { name: '+4 mais' })
    await userEvent.click(showMoreLink)

    expect(onSelectDay).not.toHaveBeenCalled()
    expect(screen.getAllByText('Vestido Azul').length).toBeGreaterThan(0)
  })

  it('renders the overflow link as "+N mais" instead of the react-big-calendar English default', () => {
    mockLayoutHeights()
    render(
      <MonthView
        allocations={sameDayAllocations()}
        dateField="checkoutDate"
        onSelectDay={vi.fn()}
        productNames={productNames}
        products={products}
        clientNames={clientNames}
        date={new Date(2026, 6, 22)}
        onNavigate={vi.fn()}
      />,
    )

    // 5 allocations, 4 hidden: the count is the number of events the cell could
    // not fit, not the day total.
    expect(screen.getByRole('button', { name: '+4 mais' })).toBeInTheDocument()
    expect(screen.queryByText(/\+\d+ more$/)).not.toBeInTheDocument()
  })
})
