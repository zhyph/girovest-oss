import { describe, it, expect } from 'vitest'
import { clientSchema } from './clientSchemas.ts'

describe('clientSchema', () => {
  it('accepts a valid client', () => {
    const result = clientSchema.safeParse({
      name: 'Maria Silva', phone: '11999999999', email: 'maria@example.com', notes: '',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid email', () => {
    const result = clientSchema.safeParse({
      name: 'Maria Silva', phone: '11999999999', email: 'not-an-email',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty name', () => {
    const result = clientSchema.safeParse({ name: '', phone: '1', email: 'a@b.com' })
    expect(result.success).toBe(false)
  })
})
