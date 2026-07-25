import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import { PRODUCTS_KEY } from './useProducts.ts'
import type { Product, SseTicketResponse } from './productSchemas.ts'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

// Rotate ~1 minute before the 5-minute server-side ticket TTL, well clear
// of any single request's latency. EventSource's native reconnect
// re-requests the exact same URL, so relying on it past the ticket's TTL
// would fail forever — this proactively opens a fresh connection instead.
const ROTATE_BEFORE_EXPIRY_MS = 60 * 1000

// If minting a ticket or opening the stream fails before it ever connects
// (transient network blip, server not up yet, a transient auth issue),
// EventSource's native reconnect never gets a chance to kick in — retry
// connect() ourselves so a failure here isn't a permanent dead end.
const CONNECT_RETRY_DELAY_MS = 5 * 1000

interface PhotoEventData {
  productId: string
  photos: string[]
}

export function useProductPhotoEvents(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    let cancelled = false
    let source: EventSource | null = null
    let rotateTimer: ReturnType<typeof setTimeout> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    async function connect() {
      try {
        const { ticket, expiresAt } = await apiFetch<SseTicketResponse>('/api/products/events/ticket', {
          method: 'POST',
        })
        if (cancelled) return

        source = new EventSource(`${API_BASE_URL}/api/products/events?ticket=${ticket}`)
        source.onmessage = (event) => {
          const data = JSON.parse(event.data) as PhotoEventData
          queryClient.setQueryData<Product[]>(PRODUCTS_KEY, (old) =>
            old?.map((product) => (product.id === data.productId ? { ...product, photos: data.photos } : product)),
          )
        }

        const rotateInMs = Math.max(0, expiresAt - Date.now() - ROTATE_BEFORE_EXPIRY_MS)
        rotateTimer = setTimeout(() => {
          source?.close()
          void connect()
        }, rotateInMs)
      } catch {
        if (cancelled) return
        retryTimer = setTimeout(() => {
          void connect()
        }, CONNECT_RETRY_DELAY_MS)
      }
    }

    void connect()

    return () => {
      cancelled = true
      source?.close()
      if (rotateTimer) clearTimeout(rotateTimer)
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [queryClient])
}
