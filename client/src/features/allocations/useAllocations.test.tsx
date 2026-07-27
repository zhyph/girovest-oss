import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCheckOutAllocation, useReturnAllocation, useCancelAllocation } from './useAllocations.ts'
import * as api from '../../lib/api.ts'

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient()
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

/** Renders a hook against a QueryClient the test can inspect for invalidations. */
function renderWithSpiedClient<T>(hook: () => T) {
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const { result } = renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
  return { result, invalidatedKeys: () => invalidate.mock.calls.map(([filters]) => filters?.queryKey) }
}

function bodyOfLastCall() {
  const [, init] = vi.mocked(api.apiFetch).mock.calls[0]
  return JSON.parse(String(init?.body))
}

describe('useCheckOutAllocation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(api, 'apiFetch').mockResolvedValue({} as never)
  })

  it('does not ask for an early-checkout override by default', async () => {
    const { result } = renderHook(() => useCheckOutAllocation(), { wrapper })

    await act(() => result.current.mutateAsync({ id: 'a1', conditionNotesOut: 'ok', depositCollected: 50 }))

    expect(vi.mocked(api.apiFetch).mock.calls[0][0]).toBe('/api/allocations/a1/check-out')
    expect(bodyOfLastCall().allowEarly).toBeUndefined()
  })

  it('sends the early-checkout override when the operator confirmed it', async () => {
    const { result } = renderHook(() => useCheckOutAllocation(), { wrapper })

    await act(() => result.current.mutateAsync({ id: 'a1', allowEarly: true }))

    expect(bodyOfLastCall()).toMatchObject({ allowEarly: true })
  })
})

describe('allocation mutations invalidate the views that render them', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(api, 'apiFetch').mockResolvedValue({} as never)
  })

  // The contracts list is where staff actually press these buttons, and it
  // reads allocations from the CONTRACTS query — leaving it stale is what made
  // a completed check-out look like it had not happened.
  async function expectRefreshesEveryView(hook: () => { mutateAsync: (input: never) => Promise<unknown> }, variables: unknown) {
    const { result, invalidatedKeys } = renderWithSpiedClient(hook)

    await act(() => result.current.mutateAsync(variables as never))

    expect(invalidatedKeys()).toContainEqual(['contracts'])
    expect(invalidatedKeys()).toContainEqual(['allocations'])
    expect(invalidatedKeys()).toContainEqual(['calendar'])
    expect(invalidatedKeys()).toContainEqual(['products'])
  }

  it('refreshes the contracts list after a check-out', async () => {
    await expectRefreshesEveryView(useCheckOutAllocation, { id: 'a1' })
  })

  it('refreshes the contracts list after a return', async () => {
    await expectRefreshesEveryView(useReturnAllocation, { id: 'a1' })
  })

  it('refreshes the contracts list after a cancel', async () => {
    await expectRefreshesEveryView(useCancelAllocation, 'a1')
  })
})
