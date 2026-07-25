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
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  close() {
    this.closed = true
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
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
})
