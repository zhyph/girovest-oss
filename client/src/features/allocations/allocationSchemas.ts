import { z } from 'zod'

export const newAllocationSchema = z.object({
  productId: z.string().min(1),
  clientId: z.string().min(1),
  checkoutDate: z.string().min(1),
  dueDate: z.string().min(1),
  priceCharged: z.number().nonnegative(),
})

export type NewAllocationFormValues = z.infer<typeof newAllocationSchema>

export type AllocationStatus = 'reserved' | 'checked_out' | 'returned' | 'cancelled'

export interface Allocation {
  id: string
  productId: string
  clientId: string
  staffId: string
  checkoutDate: string
  dueDate: string
  actualReturnDate: string | null
  status: AllocationStatus
  priceCharged: number
  depositCollected: number | null
  depositReturned: number | null
  conditionNotesOut: string | null
  conditionNotesIn: string | null
  createdAt: string
}
