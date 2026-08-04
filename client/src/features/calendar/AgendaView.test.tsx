import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../i18n.ts'
import { AgendaView } from './AgendaView.tsx'
import { buildEntries, type CalendarEntry } from './calendarEntries.ts'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

function isoDateDaysFromNow(days: number): string {
  // Build the date string from local year/month/day components, not
  // toISOString() (which converts to UTC) -- late at night in a
  // negative-UTC-offset timezone, toISOString() rolls over to the next
  // calendar day, producing a date string one day ahead of the actual
  // local "today"/"tomorrow"/etc this test means to construct. parseDateOnly
  // (lib/date.ts), which the real AgendaView uses, correctly parses via
  // local components -- so the mismatch was in this helper, not app code.
  const date = new Date()
  date.setDate(date.getDate() + days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

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
    status: 'active', availability: 'available', code: 1, hasAllocationHistory: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

// The view groups by each entry's own date, so a fixture is a set of
// entries rather than an array plus one shared date field.
function outEntries(...allocations: Allocation[]): CalendarEntry[] {
  return buildEntries({ 'going-out': allocations, 'due-back': [], overdue: [] }, 'going-out')
}

const products = new Map([['p1', makeProduct()]])
const clientNames = new Map([['c1', 'Maria Silva']])

describe('AgendaView', () => {
  it('shows the empty message when there are no allocations', () => {
    render(<AgendaView entries={[]} products={products} clientNames={clientNames} />)
    expect(screen.getByText('Nada para mostrar neste período.')).toBeInTheDocument()
  })

  it('shows the client name alongside the product name', () => {
    render(
      <AgendaView
        entries={outEntries(makeAllocation({ checkoutDate: isoDateDaysFromNow(0) }))}
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
        entries={outEntries(
          makeAllocation({ id: 'overdue', checkoutDate: isoDateDaysFromNow(-3) }),
          makeAllocation({ id: 'today', checkoutDate: isoDateDaysFromNow(0) }),
          makeAllocation({ id: 'tomorrow', checkoutDate: isoDateDaysFromNow(1) }),
          makeAllocation({ id: 'this-week', checkoutDate: isoDateDaysFromNow(4) }),
          makeAllocation({ id: 'later', checkoutDate: isoDateDaysFromNow(20) }),
        )}
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
        entries={outEntries(makeAllocation({ checkoutDate: isoDateDaysFromNow(0) }))}
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
    render(<AgendaView entries={outEntries(...allocations)} products={products} clientNames={clientNames} />)
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('tags each row with its state once the list mixes states, and leaves the tag off when it does not', () => {
    const goingOut = makeAllocation({ id: 'out', checkoutDate: isoDateDaysFromNow(0) })
    const dueBack = makeAllocation({ id: 'back', dueDate: isoDateDaysFromNow(0) })

    const { rerender } = render(
      <AgendaView entries={outEntries(goingOut)} products={products} clientNames={clientNames} />,
    )
    // One state in the list: the tag would say the same thing on every row.
    expect(screen.queryByText('Saindo')).not.toBeInTheDocument()

    rerender(
      <AgendaView
        entries={buildEntries({ 'going-out': [goingOut], 'due-back': [dueBack], overdue: [] }, 'all')}
        products={products}
        clientNames={clientNames}
      />,
    )
    // Under "Tudo" the rows are otherwise indistinguishable from each other.
    expect(screen.getByText('Saindo')).toBeInTheDocument()
    expect(screen.getByText('Voltando')).toBeInTheDocument()
  })
})
