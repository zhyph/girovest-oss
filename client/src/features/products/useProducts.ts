import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import type { PhotoTokenResponse, Product, ProductFormValues, ProductStatus } from './productSchemas.ts'

export const PRODUCTS_KEY = ['products']

export function useProducts(options: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: PRODUCTS_KEY,
    queryFn: () => apiFetch<Product[]>('/api/products'),
    refetchInterval: options.refetchInterval,
  })
}

export function useCreateProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: ProductFormValues) =>
      apiFetch<Product>('/api/products', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY }),
  })
}

export function useUpdateProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<ProductFormValues> & { status?: ProductStatus } }) =>
      apiFetch<Product>(`/api/products/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY }),
  })
}

export function useDeleteProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY }),
  })
}

export function useIssueProductPhotoSession() {
  return useMutation({
    mutationFn: () => apiFetch<PhotoTokenResponse>('/api/products/photo-session', { method: 'POST' }),
  })
}
