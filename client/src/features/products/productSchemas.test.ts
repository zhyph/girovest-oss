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

  // The server caps these fields (server/src/lib/productValidation.ts) because
  // the phone intake route is authorized by a LAN-visible token. The desktop
  // form has to refuse the same payloads, or a user who pastes a long text into
  // "Descrição" gets an opaque 400 from a form that showed no error at all.
  const valid = {
    locationId: 'l1', name: 'Vestido Azul', category: 'casual', size: 'P', color: 'azul',
    rentalPrice: 150, depositAmount: 50,
  }

  it('rejects strings longer than the server accepts', () => {
    expect(productSchema.safeParse({ ...valid, description: 'a'.repeat(2001) }).success).toBe(false)
    expect(productSchema.safeParse({ ...valid, name: 'a'.repeat(201) }).success).toBe(false)
    for (const field of ['category', 'size', 'color'] as const) {
      expect(productSchema.safeParse({ ...valid, [field]: 'a'.repeat(101) }).success, field).toBe(false)
    }
  })

  it('rejects amounts above the server cap', () => {
    expect(productSchema.safeParse({ ...valid, rentalPrice: 1_000_001 }).success).toBe(false)
    expect(productSchema.safeParse({ ...valid, depositAmount: 1_000_001 }).success).toBe(false)
  })
})
