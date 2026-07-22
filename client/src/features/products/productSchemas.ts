import { z } from 'zod'

export const productSchema = z.object({
  locationId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().min(1),
  size: z.string().min(1),
  color: z.string().min(1),
  rentalPrice: z.number().nonnegative(),
  depositAmount: z.number().nonnegative(),
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
