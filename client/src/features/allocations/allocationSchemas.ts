export type AllocationStatus = 'reserved' | 'checked_out' | 'returned' | 'cancelled'

export interface Allocation {
  id: string
  productId: string
  clientId: string
  staffId: string
  checkoutDate: string
  actualCheckoutDate: string | null
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
