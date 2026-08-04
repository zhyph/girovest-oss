import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { MonthView } from './MonthView.tsx'
import type { Allocation } from '../allocations/allocationSchemas.ts'

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


// The grid renders event titles only; the product and client lookups it
// used to need went with the "+N mais" dialog, which the day side panel
// replaced.
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

  it('renders no period toolbar of its own — navigation belongs to the page control strip', () => {
    render(
      <MonthView
        allocations={[]}
        dateField="checkoutDate"
        onSelectDay={vi.fn()}
        productNames={new Map()}
        date={new Date(2026, 6, 22)}
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
        allocations={[]}
        dateField="checkoutDate"
        onSelectDay={vi.fn()}
        productNames={new Map()}
        date={new Date(2026, 6, 22)}
        selectedDay={new Date(2026, 6, 22)}
        onNavigate={vi.fn()}
      />,
    )

    expect(document.querySelectorAll('.rbc-day-selected')).toHaveLength(1)
  })

  it('selects the day when a day number is clicked (onDrillDown, not just empty-cell onSelectSlot)', async () => {
    const onSelectDay = vi.fn()
    render(
      <MonthView
        allocations={[]}
        dateField="checkoutDate"
        onSelectDay={onSelectDay}
        productNames={new Map()}
        date={new Date(2026, 6, 22)}
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

  it('selects the day when "+N mais" is clicked, instead of opening a second overlay', async () => {
    mockLayoutHeights()
    const onSelectDay = vi.fn()
    render(
      <MonthView
        allocations={sameDayAllocations()}
        dateField="checkoutDate"
        onSelectDay={onSelectDay}
        productNames={productNames}
        date={new Date(2026, 6, 22)}
        selectedDay={null}
        onNavigate={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '+4 mais' }))

    // The overflow affordance and the day affordance now lead to the same
    // place — the side panel — rather than a dialog and a screen swap.
    expect(onSelectDay).toHaveBeenCalledTimes(1)
    expect(onSelectDay.mock.calls[0][0]).toBeInstanceOf(Date)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the overflow link as "+N mais" instead of the react-big-calendar English default', () => {
    mockLayoutHeights()
    render(
      <MonthView
        allocations={sameDayAllocations()}
        dateField="checkoutDate"
        onSelectDay={vi.fn()}
        productNames={productNames}
        date={new Date(2026, 6, 22)}
        selectedDay={null}
        onNavigate={vi.fn()}
      />,
    )

    // 5 allocations, 4 hidden: the count is the number of events the cell could
    // not fit, not the day total.
    expect(screen.getByRole('button', { name: '+4 mais' })).toBeInTheDocument()
    expect(screen.queryByText(/\+\d+ more$/)).not.toBeInTheDocument()
  })
})
