import { createElement } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as api from '../../lib/api.ts'
import { BACKGROUND_REQUEST_HEADER } from '../../lib/api.ts'
import { useContract } from './useContracts.ts'

function renderWithClient<T>(hook: () => T) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children),
  })
}

function requestHeaders(spy: ReturnType<typeof vi.spyOn>): Record<string, string> | undefined {
  const [, init] = spy.mock.calls[0] as [string, RequestInit | undefined]
  return init?.headers as Record<string, string> | undefined
}

describe('useContract', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // SignRemotelyModal polls this every 3 seconds for as long as it is open, and
  // it never closes itself — staff can walk out at the end of a shift leaving
  // the modal on screen. Unmarked, those 1200 requests an hour would renew the
  // session forever and an idle terminal would never expire.
  it('marks a polled fetch as a background request', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockResolvedValue({ id: 'ct1' } as never)

    renderWithClient(() => useContract('ct1', { refetchInterval: 3000 }))

    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy.mock.calls[0][0]).toBe('/api/contracts/ct1')
    expect(requestHeaders(spy)?.[BACKGROUND_REQUEST_HEADER]).toBe('1')
  })

  it('leaves an ordinary one-shot fetch unmarked, so it still renews the session', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockResolvedValue({ id: 'ct1' } as never)

    renderWithClient(() => useContract('ct1'))

    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(requestHeaders(spy)?.[BACKGROUND_REQUEST_HEADER]).toBeUndefined()
  })
})
