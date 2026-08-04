import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { CalendarPage } from './CalendarPage.tsx'
import * as useCalendarModule from './useCalendar.ts'
import * as useProductsModule from '../products/useProducts.ts'
import * as useClientsModule from '../clients/useClients.ts'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

// The month grid is lazy-loaded behind a Suspense boundary, so "has it
// mounted?" needs an explicit wait. It used to be answered by looking for
// react-big-calendar's own "Hoje" toolbar button; that toolbar is gone
// (its job moved to the page's single control strip), so the grid's own
// container class is the signal now. Keyed off the library's class rather
// than a test-only attribute, to keep test scaffolding out of production
// markup.
const monthGrid = () => document.querySelector('.rbc-month-view')
// The generous timeout covers transforming react-big-calendar's module
// graph on first import under Vitest — several seconds idle, longer when
// the whole suite competes for CPU — not the dynamic import itself.
const findMonthGrid = () => waitFor(() => expect(monthGrid()).toBeTruthy(), { timeout: 30000 })

function mockHooks() {
  vi.spyOn(useCalendarModule, 'useCalendarTab').mockReturnValue({ data: [], isLoading: false } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [], isLoading: false } as never)
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [], isLoading: false } as never)
}

// The page fetches all three sets on every render and the chips decide which
// of them is on screen, so a fixture has to answer per set rather than hand
// the same array to all three -- otherwise "Tudo" sees the same allocation
// three times over and no test can tell the sets apart. The arrays are built
// once so their identity is stable across renders.
function mockCalendarTabs(byTab: Partial<Record<useCalendarModule.CalendarTab, Allocation[]>>) {
  const data: Record<useCalendarModule.CalendarTab, Allocation[]> = {
    'going-out': byTab['going-out'] ?? [],
    'due-back': byTab['due-back'] ?? [],
    overdue: byTab.overdue ?? [],
  }
  vi.spyOn(useCalendarModule, 'useCalendarTab').mockImplementation(
    ((tab: useCalendarModule.CalendarTab) => ({ data: data[tab], isLoading: false })) as never,
  )
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
    code: 1,
    hasAllocationHistory: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('CalendarPage', () => {
  it('presents one control strip: period navigation, status chips and the view toggle', () => {
    mockHooks()
    render(<CalendarPage />)

    // Period navigation lives here exactly once, and by a stable name —
    // the old button renamed itself between "Ver mês" and "Ver agenda",
    // so the same control had two different accessible names depending on
    // state, on top of react-big-calendar's own toolbar doing the job a
    // third time.
    expect(screen.getByRole('button', { name: 'Mês anterior' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Próximo mês' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hoje' })).toBeInTheDocument()

    // The view toggle is a two-option control with both options always
    // present, not one button that renames itself.
    expect(screen.getByRole('button', { name: 'Grade' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agenda' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver mês' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver agenda' })).not.toBeInTheDocument()

    // Status filters are chips in the same strip rather than a separate row,
    // and the strip opens on all activity: "Saindo" used to be selected on
    // arrival, which answered half the question before anyone had asked it.
    expect(screen.getByRole('button', { name: /Tudo/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Saindo/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /Voltando/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /Atrasados/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows every chip its own live count, "Tudo" included', () => {
    mockCalendarTabs({
      'going-out': [makeAllocation({ id: 'out-1' }), makeAllocation({ id: 'out-2' })],
      'due-back': [makeAllocation({ id: 'back-1' })],
    })
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [], isLoading: false } as never)
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [], isLoading: false } as never)

    render(<CalendarPage />)

    expect(screen.getByRole('button', { name: /^Tudo\s*3$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Saindo\s*2$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Voltando\s*1$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Atrasados\s*0$/ })).toBeInTheDocument()
  })

  it('shows what goes out and what comes back together on arrival, before any chip is touched', async () => {
    mockCalendarTabs({
      'going-out': [makeAllocation({ id: 'out-1', checkoutDate: currentMonthDay(1) })],
      'due-back': [makeAllocation({ id: 'back-1', dueDate: currentMonthDay(10) })],
    })
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [], isLoading: false } as never)
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [], isLoading: false } as never)

    render(<CalendarPage />)
    await findMonthGrid()

    // Both directions are in the grid at once. Under the old default only
    // "Saindo" was, and seeing the returns meant knowing to click for them.
    expect(await screen.findByText('• 1 saindo')).toBeInTheDocument()
    expect(screen.getByText('• 1 voltando')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Saindo/ }))
    expect(screen.getByText('• 1 saindo')).toBeInTheDocument()
    expect(screen.queryByText('• 1 voltando')).not.toBeInTheDocument()
  }, 45000)

  it('keeps a single "Hoje" control when the lazy month grid has mounted', async () => {
    mockHooks()
    render(<CalendarPage />)

    // Waits for MonthView's chunk to resolve through the Suspense boundary
    // before counting, so this cannot pass merely because the grid had not
    // mounted yet. The generous timeout is for transforming
    // react-big-calendar's module graph on first import under Vitest, not
    // for the dynamic import itself — it takes several seconds on an idle
    // machine and longer when the full suite competes for CPU.
    await findMonthGrid()

    expect(screen.getAllByRole('button', { name: 'Hoje' })).toHaveLength(1)
  }, 45000)

  it('switches the main area between grid and agenda without renaming the control', async () => {
    mockHooks()
    render(<CalendarPage />)

    await findMonthGrid()
    expect(screen.getByRole('button', { name: 'Grade' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Agenda' }))
    expect(screen.getByRole('button', { name: 'Agenda' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Grade' })).toHaveAttribute('aria-pressed', 'false')
    expect(monthGrid()).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Grade' }))
    await findMonthGrid()
  }, 45000)

  it('shows the selected day in a side panel instead of swapping the screen', async () => {
    mockHooks()
    render(<CalendarPage />)

    await findMonthGrid()

    // Nothing is selected until a day is picked.
    expect(
      screen.getByText('Selecione um dia no calendário para ver o que sai e o que volta.'),
    ).toBeInTheDocument()

    await userEvent.click(document.querySelector('.rbc-button-link') as HTMLElement)

    // The grid is still on screen: picking a day fills the panel beside it
    // rather than navigating away, which is what the old agenda swap did.
    expect(monthGrid()).toBeTruthy()
    await waitFor(() =>
      expect(
        screen.queryByText('Selecione um dia no calendário para ver o que sai e o que volta.'),
      ).not.toBeInTheDocument(),
    )
  }, 45000)

  // The month grid no longer prints piece names: a day cell summarises by
  // state and shows faces, and the names moved to the lists. So the product
  // lookup these two tests are about is now checked where it renders.
  it('renders the product name looked up from useProducts when the productId matches', async () => {
    mockCalendarTabs({ 'going-out': [makeAllocation({ productId: 'product-1' })] })
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({
      data: [makeProduct({ id: 'product-1', name: 'Vestido Azul' })],
      isLoading: false,
    } as never)
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [], isLoading: false } as never)

    render(<CalendarPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Agenda' }))

    expect(await screen.findByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.queryByText('product-1')).not.toBeInTheDocument()
  }, 45000)

  it('falls back to the raw productId when no matching product is found', async () => {
    mockCalendarTabs({ 'going-out': [makeAllocation({ productId: 'unknown-product-id' })] })
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({
      data: [makeProduct({ id: 'product-1', name: 'Vestido Azul' })],
      isLoading: false,
    } as never)
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [], isLoading: false } as never)

    render(<CalendarPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Agenda' }))

    expect(await screen.findByText('unknown-product-id')).toBeInTheDocument()
    expect(screen.queryByText('Vestido Azul')).not.toBeInTheDocument()
  }, 45000)

  it('opens the day panel with the day\'s pieces named, which the cell no longer does', async () => {
    mockCalendarTabs({
      'going-out': [makeAllocation({ productId: 'product-1', checkoutDate: currentMonthDay(1) })],
    })
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({
      data: [makeProduct({ id: 'product-1', name: 'Vestido Azul' })],
      isLoading: false,
    } as never)
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [], isLoading: false } as never)

    render(<CalendarPage />)
    await findMonthGrid()

    // The cell says how much and of what; nothing in the grid is named.
    expect(await screen.findByText('• 1 saindo')).toBeInTheDocument()
    expect(screen.queryByText('Vestido Azul')).not.toBeInTheDocument()

    const dayCells = document.querySelectorAll('.rbc-button-link')
    const firstOfMonth = Array.from(dayCells).find((cell) => cell.textContent === '01') as HTMLElement
    expect(firstOfMonth).toBeTruthy()
    firstOfMonth.click()

    // Clicking the day still leads to the full list, names and all.
    expect(await screen.findByText('Vestido Azul')).toBeInTheDocument()
  }, 45000)
})
