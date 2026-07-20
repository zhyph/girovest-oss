import { describe, it, expect } from 'vitest'
import { newAllocationSchema } from './allocationSchemas.ts'

describe('newAllocationSchema', () => {
  it('accepts a valid allocation request', () => {
    const result = newAllocationSchema.safeParse({
      productId: 'p1', clientId: 'c1', checkoutDate: '2026-08-01', dueDate: '2026-08-05', priceCharged: 100,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a missing productId', () => {
    const result = newAllocationSchema.safeParse({
      productId: '', clientId: 'c1', checkoutDate: '2026-08-01', dueDate: '2026-08-05', priceCharged: 100,
    })
    expect(result.success).toBe(false)
  })
})
