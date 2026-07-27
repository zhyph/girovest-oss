import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCheckOutAllocation } from './useAllocations.ts'
import * as api from '../../lib/api.ts'

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient()
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
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
