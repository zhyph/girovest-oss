import { describe, it, expect } from 'vitest'
import { newContractSchema } from './contractSchemas.ts'

describe('newContractSchema', () => {
  it('accepts a valid multi-item contract with installments', () => {
    const result = newContractSchema.safeParse({
      locationId: 'loc1',
      clientId: 'client1',
      eventDate: '2026-10-03',
      paymentMethod: 'PIX',
      items: [
        { productId: 'p1', checkoutDate: '2026-10-02', dueDate: '2026-10-05', priceCharged: 100 },
        { productId: 'p2', checkoutDate: '2026-10-02', dueDate: '2026-10-05', priceCharged: 150 },
      ],
      installments: [{ dueDate: '2026-09-20', amount: 125 }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts zero installments', () => {
    const result = newContractSchema.safeParse({
      locationId: 'loc1',
      clientId: 'client1',
      eventDate: '2026-10-03',
      paymentMethod: 'PIX',
      items: [{ productId: 'p1', checkoutDate: '2026-10-02', dueDate: '2026-10-05', priceCharged: 100 }],
      installments: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a contract with no items', () => {
    const result = newContractSchema.safeParse({
      locationId: 'loc1',
      clientId: 'client1',
      eventDate: '2026-10-03',
      paymentMethod: 'PIX',
      items: [],
      installments: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing clientId', () => {
    const result = newContractSchema.safeParse({
      locationId: 'loc1',
      clientId: '',
      eventDate: '2026-10-03',
      paymentMethod: 'PIX',
      items: [{ productId: 'p1', checkoutDate: '2026-10-02', dueDate: '2026-10-05', priceCharged: 100 }],
      installments: [],
    })
    expect(result.success).toBe(false)
  })
})
