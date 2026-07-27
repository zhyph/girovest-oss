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
  rentalPrice: z.number().nonnegative().max(MAX_PRICE),
  depositAmount: z.number().nonnegative().max(MAX_PRICE),
  photos: z.array(z.string()).optional(),
})

export type ProductFormValues = z.infer<typeof productSchema>

export type ProductStatus = 'active' | 'maintenance' | 'retired'
export type ProductAvailability = 'available' | 'reserved' | 'rented'

export interface Product extends ProductFormValues {
  id: string
  status: ProductStatus
  availability: ProductAvailability
  hasAllocationHistory: boolean
  createdAt: string
}

export interface PhotoTokenResponse {
  token: string
  expiresAt: string
  port: number
  candidates: { interfaceName: string; address: string }[]
}

export interface SseTicketResponse {
  ticket: string
  expiresAt: number
}
