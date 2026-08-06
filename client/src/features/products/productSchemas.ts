import { z } from 'zod'

// Bounds mirror server/src/lib/productValidation.ts, which the phone intake
// route shares with POST /api/products. Without them the desktop form happily
// submits a payload the server rejects with a generic 400 and no field to blame.
const MAX_PRICE = 1_000_000

export const productSchema = z.object({
  locationId: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().min(1).max(100),
  size: z.string().min(1).max(100),
  color: z.string().min(1).max(100),
  rentalPrice: z.number().positive().max(MAX_PRICE),
  depositAmount: z.number().nonnegative().max(MAX_PRICE),
  photos: z.array(z.string()).optional(),
})

export type ProductFormValues = z.infer<typeof productSchema>

export type ProductStatus = 'active' | 'maintenance' | 'retired'
export type ProductAvailability = 'available' | 'reserved' | 'rented' | 'maintenance'

export interface Product extends ProductFormValues {
  id: string
  /**
   * Sequential per-shop reference, assigned by the server exactly like a
   * contract number. Null only on a piece that predates the field and has
   * not been through the startup backfill yet.
   */
  code: number | null
  status: ProductStatus
  availability: ProductAvailability
  /**
   * Set only while `availability` is `'available'` — see server/productService.ts.
   * Optional (not just nullable) so the many product fixtures across the test
   * suite that predate this field keep compiling without every one of them
   * being touched; consumers treat missing and `null` the same.
   */
  nextReservation?: UpcomingReservation | null
  hasAllocationHistory: boolean
  createdAt: string
}

export interface UpcomingReservation {
  from: string
  to: string
  clientName: string
  contractNumber: number
}

export interface PhotoTokenResponse {
  token: string
  expiresAt: string
  mode: 'lan' | 'relay'
  port?: number
  candidates?: { interfaceName: string; address: string }[]
  relayUrl?: string
  /** See SigningTokenResponse.relayUnavailable — same relay-connect failure. */
  relayUnavailable?: boolean
}

export interface SseTicketResponse {
  ticket: string
  expiresAt: number
}
