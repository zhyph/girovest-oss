import { createElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useProductPhotoEvents } from './useProductPhotoEvents.ts'
import { PRODUCTS_KEY } from './useProducts.ts'
import { setToken, clearToken } from '../../lib/auth.ts'

const originalFetch = global.fetch
const originalEventSource = global.EventSource

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  // Named SSE frames never reach onmessage, so the fake has to model
  // addEventListener for the product-created path to be testable at all.
  listeners: Record<string, ((event: { data: string }) => void)[]> = {}
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  close() {
    this.closed = true
  }
  addEventListener(type: string, listener: (event: { data: string }) => void) {
    ;(this.listeners[type] ??= []).push(listener)
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
  emitNamed(type: string, data: unknown) {
    for (const listener of this.listeners[type] ?? []) {
      listener({ data: JSON.stringify(data) })
    }
  }
}

beforeEach(() => {
  setToken('test-token')
  FakeEventSource.instances = []
  // @ts-expect-error jsdom has no native EventSource
  global.EventSource = FakeEventSource
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: () => Promise.resolve({ ticket: 'fake-ticket', expiresAt: Date.now() + 5 * 60 * 1000 }),
  })
})

afterEach(() => {
  global.fetch = originalFetch
  global.EventSource = originalEventSource
  clearToken()
  vi.restoreAllMocks()
})

function renderWithClient(queryClient: QueryClient) {
  return renderHook(() => useProductPhotoEvents(), {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children),
  })
}

describe('useProductPhotoEvents', () => {
  it('mints a ticket and opens an EventSource with it in the URL', async () => {
    const queryClient = new QueryClient()
    renderWithClient(queryClient)

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    expect(FakeEventSource.instances[0].url).toContain('ticket=fake-ticket')
  })

  it('patches only the matching product in the cache, leaving others untouched', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(PRODUCTS_KEY, [
      { id: 'p1', photos: [], name: 'A' },
      { id: 'p2', photos: [], name: 'B' },
    ])
    renderWithClient(queryClient)
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))

    FakeEventSource.instances[0].emit({ productId: 'p2', photos: ['/api/products/p2/photos/x.jpg'] })

    await waitFor(() => {
      const cached = queryClient.getQueryData(PRODUCTS_KEY) as { id: string; photos: string[] }[]
      expect(cached.find((p) => p.id === 'p2')?.photos).toEqual(['/api/products/p2/photos/x.jpg'])
      expect(cached.find((p) => p.id === 'p1')?.photos).toEqual([])
    })
  })

  describe('product-created', () => {
    it('prepends a product created from the phone to the cached list', async () => {
      const queryClient = new QueryClient()
      queryClient.setQueryData(PRODUCTS_KEY, [{ id: 'p1', photos: [], name: 'A' }])
      renderWithClient(queryClient)
      await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))

      FakeEventSource.instances[0].emitNamed('product-created', { id: 'p2', photos: [], name: 'Novo' })

      await waitFor(() => {
        const cached = queryClient.getQueryData(PRODUCTS_KEY) as { id: string }[]
        // The list is ordered createdAt desc, so the newest row goes first.
        expect(cached.map((p) => p.id)).toEqual(['p2', 'p1'])
      })
    })

    it('does not duplicate a product that is already cached', async () => {
      const queryClient = new QueryClient()
      queryClient.setQueryData(PRODUCTS_KEY, [{ id: 'p1', photos: [], name: 'A' }])
      renderWithClient(queryClient)
      await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))

      FakeEventSource.instances[0].emitNamed('product-created', { id: 'p2', photos: [], name: 'Novo' })
      FakeEventSource.instances[0].emitNamed('product-created', { id: 'p2', photos: [], name: 'Novo' })

      await waitFor(() => {
        const cached = queryClient.getQueryData(PRODUCTS_KEY) as { id: string }[]
        expect(cached.map((p) => p.id)).toEqual(['p2', 'p1'])
      })
    })

    it('does not crash or seed the cache when the list was never fetched', async () => {
      const queryClient = new QueryClient()
      renderWithClient(queryClient)
      await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))

      FakeEventSource.instances[0].emitNamed('product-created', { id: 'p2', photos: [], name: 'Novo' })

      expect(queryClient.getQueryData(PRODUCTS_KEY)).toBeUndefined()
    })
  })

  describe('when the ticket-mint fetch fails', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('does not leave an unhandled rejection and retries until it succeeds', async () => {
      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('network blip'))
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ ticket: 'retry-ticket', expiresAt: Date.now() + 5 * 60 * 1000 }),
        })

      const queryClient = new QueryClient()
      renderWithClient(queryClient)

      // Let the rejected first attempt settle before advancing timers.
      await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))

      expect(FakeEventSource.instances).toHaveLength(0)

      // Advance past the retry delay to trigger the second connect() attempt.
      await vi.advanceTimersByTimeAsync(5 * 1000)

      await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
      expect(FakeEventSource.instances[0].url).toContain('ticket=retry-ticket')
    })
  })
})
