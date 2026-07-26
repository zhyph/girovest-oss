import { describe, it, expect } from 'vitest'
import { newContractSchema } from './contractSchemas.ts'

describe('newContractSchema', () => {
  it('accepts a valid multi-item contract with installments', () => {
    const result = newContractSchema.safeParse({
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
      clientId: '',
      eventDate: '2026-10-03',
      paymentMethod: 'PIX',
      items: [{ productId: 'p1', checkoutDate: '2026-10-02', dueDate: '2026-10-05', priceCharged: 100 }],
      installments: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an eventDate that is not a real calendar day, distinctly from a missing one', () => {
    const result = newContractSchema.safeParse({
      clientId: 'client1',
      eventDate: '2026-02-31',
      paymentMethod: 'PIX',
      items: [{ productId: 'p1', checkoutDate: '2026-10-02', dueDate: '2026-10-05', priceCharged: 100 }],
      installments: [],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const eventDateIssue = result.error.issues.find((issue) => issue.path.join('.') === 'eventDate')
      expect(eventDateIssue?.code).toBe('custom')
    }
  })

  it('rejects an impossible checkoutDate/dueDate on a line item', () => {
    const result = newContractSchema.safeParse({
      clientId: 'client1',
      eventDate: '2026-10-03',
      paymentMethod: 'PIX',
      items: [{ productId: 'p1', checkoutDate: '2026-02-30', dueDate: '2026-10-05', priceCharged: 100 }],
      installments: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an impossible installment dueDate', () => {
    const result = newContractSchema.safeParse({
      clientId: 'client1',
      eventDate: '2026-10-03',
      paymentMethod: 'PIX',
      items: [{ productId: 'p1', checkoutDate: '2026-10-02', dueDate: '2026-10-05', priceCharged: 100 }],
      installments: [{ dueDate: '2026-04-31', amount: 100 }],
    })
    expect(result.success).toBe(false)
  })
})
