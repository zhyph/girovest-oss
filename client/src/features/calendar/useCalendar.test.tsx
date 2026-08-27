import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as apiModule from '../../lib/api.ts'
import { overdueAsOf, toIsoDateOnly } from '../../lib/date.ts'
import { useCalendarTab } from './useCalendar.ts'

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

// A month deliberately far from today, so "as of the month on screen" and
// "as of today" can never coincide by accident. Built from LOCAL components,
// the way CalendarPage's monthRange builds them — a fixed UTC instant would
// name a different calendar day depending on the machine's timezone, and
// these assertions are about calendar days.
const MONTH_FROM = new Date(2030, 7, 1)
const MONTH_TO = new Date(2030, 8, 0)

let apiFetch: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  apiFetch = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue([] as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useCalendarTab', () => {
  it('CRITICAL: asks for overdue as of today, not as of the end of the month on screen', async () => {
    renderHook(() => useCalendarTab('overdue', MONTH_FROM, MONTH_TO), { wrapper })

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    const url = apiFetch.mock.calls[0][0] as string
    const asOf = new Date(url.slice(url.indexOf('asOf=') + 'asOf='.length))
    const today = new Date()

    // Passing the visible month's end is what made a piece merely due later
    // that month come back as atrasado, which the all-activity default view
    // then painted red on arrival.
    expect(asOf.getTime()).toBeLessThan(MONTH_TO.getTime())
    expect(asOf.getFullYear()).toBe(today.getFullYear())
    expect(asOf.getMonth()).toBe(today.getMonth())
    expect(asOf.getDate()).toBe(today.getDate())
  })

  it('CRITICAL: asks with the same "now" Contratos does, not the end of today', async () => {
    // Landing anywhere later in the day than this — the end of today, say —
    // reaches past tomorrow's UTC-midnight due dates at UTC-3 and paints a
    // piece due TOMORROW as atrasado. Contratos' list already gets this right;
    // the two screens have to agree or the same contract reads differently
    // depending on which screen you opened.
    renderHook(() => useCalendarTab('overdue', MONTH_FROM, MONTH_TO), { wrapper })

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    const url = apiFetch.mock.calls[0][0] as string
    const asOf = decodeURIComponent(url.slice(url.indexOf('asOf=') + 'asOf='.length))

    expect(asOf).toBe(overdueAsOf().toISOString())
  })

  it('keeps the going-out and due-back windows scoped to the visible month', async () => {
    renderHook(() => useCalendarTab('going-out', MONTH_FROM, MONTH_TO), { wrapper })

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(apiFetch.mock.calls[0][0]).toBe('/api/calendar/going-out?from=2030-08-01&to=2030-08-31')
  })

  it('CRITICAL: sends whole calendar days, never a local-midnight instant', async () => {
    // `MONTH_FROM.toISOString()` is 2030-08-01T03:00:00Z at UTC-3, which sorts
    // after the 1st's own UTC-midnight checkoutDate — so `gte` skipped the
    // first day of every range. A booking on the 1st had no cell in the grid,
    // no row in the day panel, and was missing from the chip counts.
    renderHook(() => useCalendarTab('due-back', MONTH_FROM, MONTH_TO), { wrapper })

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    const url = apiFetch.mock.calls[0][0] as string
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1))

    expect(params.get('from')).toBe(toIsoDateOnly(MONTH_FROM))
    expect(params.get('to')).toBe(toIsoDateOnly(MONTH_TO))
    expect(url).not.toContain('T')
  })
})
