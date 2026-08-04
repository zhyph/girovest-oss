import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as apiModule from '../../lib/api.ts'
import { useCalendarTab } from './useCalendar.ts'

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

// A month deliberately far from today, so "as of the month on screen" and
// "as of today" can never coincide by accident.
const MONTH_FROM = new Date('2030-08-01T03:00:00.000Z')
const MONTH_TO = new Date('2030-09-01T02:59:59.000Z')

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

  it('keeps the going-out and due-back windows scoped to the visible month', async () => {
    renderHook(() => useCalendarTab('going-out', MONTH_FROM, MONTH_TO), { wrapper })

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(apiFetch.mock.calls[0][0]).toBe(
      `/api/calendar/going-out?from=${MONTH_FROM.toISOString()}&to=${MONTH_TO.toISOString()}`,
    )
  })
})
