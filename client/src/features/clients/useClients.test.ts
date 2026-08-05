import { createElement } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as api from '../../lib/api.ts'
import { useClients, useCreateClient, CLIENTS_KEY } from './useClients.ts'
import type { Client } from './clientSchemas.ts'

const created: Client = {
  id: 'c-new', name: 'Nova Cliente', phone: '11999990000', email: '', notes: '',
  identityDocuments: [], addressLines: [], hasAllocationHistory: false, createdAt: '2026-07-31',
  contractCount: 0, lastRentalProductId: null, lastRentalDate: null,
}

function renderWithClient<T>(hook: () => T, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { queryClient, ...renderHook(hook, {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children),
  }) }
}

describe('useCreateClient', () => {
  afterEach(() => vi.restoreAllMocks())

  it('seeds the clients cache with the created client synchronously, before any refetch', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation((url, options) => {
      if (url === '/api/clients' && options?.method === 'POST') return Promise.resolve(created)
      return new Promise(() => {}) // GET refetch never resolves in this test — proves the seed alone is enough
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(CLIENTS_KEY, [])

    const { result } = renderWithClient(() => ({ create: useCreateClient(), list: useClients() }), queryClient)

    await result.current.create.mutateAsync({
      name: 'Nova Cliente', phone: '11999990000', email: '', notes: '', identityDocuments: [], addressLines: [],
    })

    await waitFor(() => expect(result.current.list.data).toEqual([created]))
  })
})
