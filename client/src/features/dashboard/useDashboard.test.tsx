import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as apiModule from '../../lib/api.ts'
import { overdueAsOf, toIsoDateOnly } from '../../lib/date.ts'
import { useDashboard } from './useDashboard.ts'

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

let apiFetch: ReturnType<typeof vi.spyOn>

function requestedUrls(): string[] {
  return (apiFetch.mock.calls as unknown as [string][]).map(([url]) => url)
}

function urlFor(path: string): string {
  const call = requestedUrls().find((url) => url.startsWith(path))
  if (!call) throw new Error(`no request to ${path}; saw ${JSON.stringify(requestedUrls())}`)
  return call
}

function paramsOf(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf('?') + 1))
}

beforeEach(() => {
  apiFetch = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue([] as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * DashboardPage.test.tsx mocks this hook wholesale, so nothing there can see
 * what the Painel actually asks the server for. These assertions are about the
 * request itself, which is where the "today is really tomorrow" bug lived.
 */
describe('useDashboard', () => {
  it('CRITICAL: asks for today as a calendar day, not a local-midnight instant', async () => {
    renderHook(() => useDashboard(), { wrapper })
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    const today = toIsoDateOnly(new Date())
    for (const path of ['/api/calendar/going-out', '/api/calendar/due-back']) {
      const params = paramsOf(urlFor(path))
      // startOfToday().toISOString() is T03:00:00Z at UTC-3, which sorts after
      // today's own UTC-midnight checkoutDate and inside tomorrow's — so
      // "Saindo hoje" listed tomorrow's pieces and hid the ones actually going
      // out today, every single morning.
      expect(params.get('from')).toBe(today)
      expect(params.get('to')).toBe(today)
    }
  })

  it('CRITICAL: asks for overdue with the same "now" the Calendário uses', async () => {
    renderHook(() => useDashboard(), { wrapper })
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    const asOf = paramsOf(urlFor('/api/calendar/overdue')).get('asOf')

    // The end of today is past tomorrow's UTC-midnight due dates at UTC-3, so
    // "Atrasados" counted pieces due back tomorrow and sent the shop chasing
    // clients who are not late.
    expect(asOf).toBe(overdueAsOf().toISOString())
  })

  it('starts the upcoming window tomorrow, so it does not repeat "Saindo hoje"', async () => {
    // Both panels sit side by side on the Painel with no filtering between
    // them, so an upcoming window that includes today lists every one of
    // today's departures twice.
    renderHook(() => useDashboard(), { wrapper })
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    const dayAfter = (days: number) => {
      const d = new Date()
      d.setDate(d.getDate() + days)
      return toIsoDateOnly(d)
    }
    const upcoming = requestedUrls()
      .filter((url) => url.startsWith('/api/calendar/going-out'))
      .map(paramsOf)
      .find((params) => params.get('to') !== params.get('from'))

    expect(upcoming?.get('from')).toBe(dayAfter(1))
    expect(upcoming?.get('to')).toBe(dayAfter(7))
    expect(upcoming?.get('from')).not.toBe(toIsoDateOnly(new Date()))
  })
})
