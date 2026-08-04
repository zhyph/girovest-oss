import { createElement } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as api from '../../lib/api.ts'
import { useProducts, useCreateProduct, PRODUCTS_KEY } from './useProducts.ts'
import type { Product } from './productSchemas.ts'

const created: Product = {
  id: 'p-new', locationId: 'l1', name: 'Vestido Novo', category: 'festa', size: 'M', color: 'rosa',
  rentalPrice: 200, depositAmount: 100, photos: [], status: 'active', availability: 'available',
  code: 1,
  hasAllocationHistory: false, createdAt: '2026-07-31',
}

function renderWithClient<T>(hook: () => T, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { queryClient, ...renderHook(hook, {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children),
  }) }
}

describe('useCreateProduct', () => {
  afterEach(() => vi.restoreAllMocks())

  it('seeds the products cache with the created product synchronously, before any refetch', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation((url, options) => {
      if (url === '/api/products' && options?.method === 'POST') return Promise.resolve(created)
      return new Promise(() => {})
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(PRODUCTS_KEY, [])

    const { result } = renderWithClient(() => ({ create: useCreateProduct(), list: useProducts() }), queryClient)

    await result.current.create.mutateAsync({
      locationId: 'l1', name: 'Vestido Novo', category: 'festa', size: 'M', color: 'rosa',
      rentalPrice: 200, depositAmount: 100,
    })

    await waitFor(() => expect(result.current.list.data).toEqual([created]))
  })
})
