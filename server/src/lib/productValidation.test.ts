import { describe, it, expect } from 'vitest'
import { productCreateSchema } from './productValidation.js'

const VALID = {
  name: 'Vestido Longo',
  category: 'festa',
  size: 'M',
  color: 'azul',
  rentalPrice: 250,
  depositAmount: 125,
}

describe('productCreateSchema', () => {
  it('accepts a minimal valid product, with description optional', () => {
    expect(productCreateSchema.safeParse(VALID).success).toBe(true)
    expect(productCreateSchema.safeParse({ ...VALID, description: 'Com brilho' }).success).toBe(true)
  })

  it.each(['name', 'category', 'size', 'color', 'rentalPrice', 'depositAmount'])(
    'rejects a payload missing %s',
    (field) => {
      const payload: Record<string, unknown> = { ...VALID }
      delete payload[field]
      expect(productCreateSchema.safeParse(payload).success).toBe(false)
    },
  )

  it.each(['name', 'category', 'size', 'color'])('rejects an empty %s', (field) => {
    expect(productCreateSchema.safeParse({ ...VALID, [field]: '' }).success).toBe(false)
  })

  it.each(['rentalPrice', 'depositAmount'])('rejects a negative %s', (field) => {
    expect(productCreateSchema.safeParse({ ...VALID, [field]: -1 }).success).toBe(false)
  })

  it('rejects a zero rentalPrice', () => {
    expect(productCreateSchema.safeParse({ ...VALID, rentalPrice: 0 }).success).toBe(false)
  })

  it('accepts a zero depositAmount', () => {
    expect(productCreateSchema.safeParse({ ...VALID, depositAmount: 0 }).success).toBe(true)
  })

  it.each(['rentalPrice', 'depositAmount'])('rejects a %s sent as a string', (field) => {
    expect(productCreateSchema.safeParse({ ...VALID, [field]: '250' }).success).toBe(false)
  })

  // The phone's create form posts to a token-only endpoint, so unbounded
  // strings would be an unauthenticated way to fill the database.
  it.each([
    ['name', 200],
    ['category', 100],
    ['size', 100],
    ['color', 100],
    ['description', 2000],
  ])('caps %s at %i characters', (field, max) => {
    expect(productCreateSchema.safeParse({ ...VALID, [field]: 'a'.repeat(max) }).success).toBe(true)
    expect(productCreateSchema.safeParse({ ...VALID, [field]: 'a'.repeat(max + 1) }).success).toBe(false)
  })

  it.each(['rentalPrice', 'depositAmount'])('caps %s at a sane amount', (field) => {
    expect(productCreateSchema.safeParse({ ...VALID, [field]: 1_000_000 }).success).toBe(true)
    expect(productCreateSchema.safeParse({ ...VALID, [field]: 1_000_001 }).success).toBe(false)
  })

  // The schema is shared with the token-authorized phone endpoint, where the
  // location must come from the token row alone — so it must not even have a
  // locationId field to strip.
  it('has no locationId field and drops one supplied by the caller', () => {
    const parsed = productCreateSchema.safeParse({ ...VALID, locationId: 'hostile-location' })
    expect(parsed.success).toBe(true)
    expect(parsed.data).not.toHaveProperty('locationId')
  })
})
