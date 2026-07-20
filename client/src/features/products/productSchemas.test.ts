import { describe, it, expect } from 'vitest'
import { productSchema } from './productSchemas.ts'

describe('productSchema', () => {
  it('accepts a valid product', () => {
    const result = productSchema.safeParse({
      locationId: 'l1', name: 'Vestido Azul', category: 'casual', size: 'P', color: 'azul',
      rentalPrice: 150, depositAmount: 50,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a negative rental price', () => {
    const result = productSchema.safeParse({
      locationId: 'l1', name: 'Vestido Azul', category: 'casual', size: 'P', color: 'azul',
      rentalPrice: -10, depositAmount: 50,
    })
    expect(result.success).toBe(false)
  })
})
