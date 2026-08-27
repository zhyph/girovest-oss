import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import * as api from './api.ts'
import { useSetupStatus } from './useSetup.ts'

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient()
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

afterEach(() => {
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
})

describe('useSetupStatus', () => {
  it('CRITICAL: still asks, even when the browser reports no network', async () => {
    /*
      React Query's default 'online' mode PAUSES a query when the browser says
      it is offline: the request is never attempted, `fetchStatus` sits at
      'paused' and the query never leaves `pending`. The login screen gates on
      this, so an operator with the router off or wifi down got a spinner and
      no way to reach the form — on an offline-first desktop app whose server
      is on the same machine. `login()` itself is a plain apiFetch and was
      never paused, so she could have logged in perfectly well.
    */
    const fetchSpy = vi.spyOn(api, 'apiFetch').mockResolvedValue({ needsSetup: false } as never)
    onlineManager.setOnline(false)

    const { result } = renderHook(() => useSetupStatus(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.fetchStatus).not.toBe('paused')
    expect(fetchSpy).toHaveBeenCalledWith('/api/setup/status')
  })
})
