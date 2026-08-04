import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../i18n.ts'
import { MonthView } from './MonthView.tsx'
import { buildEntries, type AllocationsByKind, type CalendarEntry } from './calendarEntries.ts'
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

// A fixed month, never new Date(): the grid only draws days it is showing, so
// a wall-clock-derived fixture silently stops matching once the month turns.
const JULY_2026 = new Date(2026, 6, 22)

const empty: AllocationsByKind = { 'going-out': [], 'due-back': [], overdue: [] }
const products = new Map([['p1', makeProduct()]])

function entriesFor(byKind: Partial<AllocationsByKind>): CalendarEntry[] {
  return buildEntries({ ...empty, ...byKind }, 'all')
}

// Twenty pieces leaving on one day: the case the old per-piece name pills
// turned into an unreadable wall of truncated text.
function busyDay(): CalendarEntry[] {
  return entriesFor({
    'going-out': Array.from({ length: 20 }, (_, i) =>
      makeAllocation({ id: `a${i}`, checkoutDate: '2026-07-22' }),
    ),
  })
}

describe('MonthView', () => {
  it('renders no period toolbar of its own — navigation belongs to the page control strip', () => {
    render(
      <MonthView
        entries={[]}
        products={products}
        onSelectDay={vi.fn()}
        date={JULY_2026}
        selectedDay={null}
        onNavigate={vi.fn()}
      />,
    )

    // react-big-calendar's built-in Hoje/Anterior/Próximo toolbar was the
    // third control surface doing the same job as the page's own strip and
    // its renamed view button. The grid must not bring it back.
    expect(screen.queryByRole('button', { name: 'Hoje' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Anterior' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Próximo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument()
    // The grid itself still rendered.
    expect(document.querySelector('.rbc-month-view')).toBeTruthy()
  })

  it('marks the day the side panel is describing, so clicking around the month does not lose your place', () => {
    render(
      <MonthView
        entries={[]}
        products={products}
        onSelectDay={vi.fn()}
        date={JULY_2026}
        selectedDay={JULY_2026}
        onNavigate={vi.fn()}
      />,
    )

    expect(document.querySelectorAll('.rbc-day-selected')).toHaveLength(1)
  })

  it('selects the day when a day number is clicked (onDrillDown, not just empty-cell onSelectSlot)', () => {
    const onSelectDay = vi.fn()
    render(
      <MonthView
        entries={[]}
        products={products}
        onSelectDay={onSelectDay}
        date={JULY_2026}
        selectedDay={null}
        onNavigate={vi.fn()}
      />,
    )

    const dayLink = document.querySelector('.rbc-button-link') as HTMLElement
    expect(dayLink).toBeTruthy()
    dayLink.click()

    expect(onSelectDay).toHaveBeenCalledTimes(1)
    expect(onSelectDay.mock.calls[0][0]).toBeInstanceOf(Date)
  })

  it('summarises a day by state instead of naming every piece', () => {
    render(
      <MonthView
        entries={entriesFor({
          'going-out': [
            makeAllocation({ id: 'out-1', checkoutDate: '2026-07-22' }),
            makeAllocation({ id: 'out-2', checkoutDate: '2026-07-22' }),
            makeAllocation({ id: 'out-3', checkoutDate: '2026-07-22' }),
          ],
          'due-back': [makeAllocation({ id: 'back-1', dueDate: '2026-07-22' })],
          overdue: [makeAllocation({ id: 'late-1', dueDate: '2026-07-22' })],
        })}
        products={products}
        onSelectDay={vi.fn()}
        date={JULY_2026}
        selectedDay={null}
        onNavigate={vi.fn()}
      />,
    )

    expect(screen.getByText('• 3 saindo')).toBeInTheDocument()
    expect(screen.getByText('• 1 voltando')).toBeInTheDocument()
    expect(screen.getByText('• 1 atrasado')).toBeInTheDocument()
    // The names belong to the day panel now; a cell that repeated them for
    // every piece was the thing that stopped being readable.
    expect(screen.queryByText('Vestido Azul')).not.toBeInTheDocument()
  })

  it('pluralises the count pills in pt-BR', () => {
    render(
      <MonthView
        entries={entriesFor({
          overdue: [
            makeAllocation({ id: 'late-1', dueDate: '2026-07-22' }),
            makeAllocation({ id: 'late-2', dueDate: '2026-07-22' }),
          ],
        })}
        products={products}
        onSelectDay={vi.fn()}
        date={JULY_2026}
        selectedDay={null}
        onNavigate={vi.fn()}
      />,
    )

    expect(screen.getByText('• 2 atrasados')).toBeInTheDocument()
  })

  it('caps the thumbnails on a busy day and reports the rest as a count', () => {
    render(
      <MonthView
        entries={busyDay()}
        products={products}
        onSelectDay={vi.fn()}
        date={JULY_2026}
        selectedDay={null}
        onNavigate={vi.fn()}
      />,
    )

    // Twenty pieces, four faces, the remaining sixteen as a number — the cell
    // stays the same height whether the day holds five pieces or fifty.
    // Queried by tag, not by role: the thumbnails carry alt="" on purpose,
    // which makes them presentational and invisible to a role query.
    expect(document.querySelectorAll('img')).toHaveLength(4)
    expect(screen.getByText('+16')).toBeInTheDocument()
    expect(screen.getByText('• 20 saindo')).toBeInTheDocument()
  })

  it('gives a busy day no second overlay to open: the day panel is the only destination', () => {
    render(
      <MonthView
        entries={busyDay()}
        products={products}
        onSelectDay={vi.fn()}
        date={JULY_2026}
        selectedDay={null}
        onNavigate={vi.fn()}
      />,
    )

    // The overflow used to be react-big-calendar's "+N mais" button, which
    // opened a dialog listing the day — a second place answering the question
    // the side panel already answers.
    expect(screen.queryByRole('button', { name: /mais/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/\+\d+ more$/)).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // There is nothing left to overflow because the cell no longer draws one
    // element per piece: twenty pieces produce four faces and two pills.
    expect(screen.queryAllByText('Vestido Azul')).toHaveLength(0)
    expect(document.querySelectorAll('img')).toHaveLength(4)
  })

  it('falls back to the placeholder swatch when a piece has no resolvable photo', () => {
    render(
      <MonthView
        entries={entriesFor({
          'going-out': [makeAllocation({ id: 'out-1', productId: 'gone', checkoutDate: '2026-07-22' })],
        })}
        products={products}
        onSelectDay={vi.fn()}
        date={JULY_2026}
        selectedDay={null}
        onNavigate={vi.fn()}
      />,
    )

    // An unresolvable product is the designed fallback, not a failure: the
    // cell still has to say that something goes out that day.
    expect(document.querySelectorAll('img')).toHaveLength(0)
    expect(document.querySelectorAll('.rbc-date-cell svg')).toHaveLength(1)
    expect(screen.getByText('• 1 saindo')).toBeInTheDocument()
  })
})
