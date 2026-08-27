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
    onSuccess: (created) => {
      const current = queryClient.getQueryData<Product[]>(PRODUCTS_KEY)
      const newData = Array.isArray(current) ? [created, ...current] : [created]
      queryClient.setQueryData<Product[]>(PRODUCTS_KEY, newData)
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY })
    },
  })
}

export function useUpdateProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string
      // `photosBaseline` is the photo list the editor loaded with. The server
      // treats `photos` as a full replacement, so without a baseline it cannot
      // tell "she removed this" from "this arrived after the drawer opened"
      // and deletes the file either way.
      values: Partial<ProductFormValues> & { status?: ProductStatus; photosBaseline?: string[] }
    }) =>
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

/**
 * Uploads picked photos to a product that already exists. Sends the same
 * JSON-of-data-URLs the phone intake page sends, so both paths land through
 * one writer on the server.
 */
export function useUploadProductPhotos() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, photos }: { id: string; photos: string[] }) =>
      apiFetch<{ photos: string[] }>(`/api/products/${id}/photos`, {
        method: 'POST',
        body: JSON.stringify({ photos }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY }),
  })
}

export function useIssueProductPhotoSession() {
  return useMutation({
    mutationFn: () => apiFetch<PhotoTokenResponse>('/api/products/photo-session', { method: 'POST' }),
  })
}
