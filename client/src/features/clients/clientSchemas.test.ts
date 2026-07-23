import { describe, it, expect } from 'vitest'
import { clientSchema } from './clientSchemas.ts'

describe('clientSchema', () => {
  it('accepts a valid client', () => {
    const result = clientSchema.safeParse({
      name: 'Maria Silva', phone: '11999999999', email: 'maria@example.com', notes: '', identityDocuments: [], addressLines: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid email', () => {
    const result = clientSchema.safeParse({
      name: 'Maria Silva', phone: '11999999999', email: 'not-an-email', identityDocuments: [], addressLines: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty name', () => {
    const result = clientSchema.safeParse({ name: '', phone: '1', email: 'a@b.com', identityDocuments: [], addressLines: [] })
    expect(result.success).toBe(false)
  })

  it('accepts a client with identity documents and address lines', () => {
    const result = clientSchema.safeParse({
      name: 'Maria Silva',
      phone: '11999999999',
      email: 'maria@example.com',
      notes: '',
      identityDocuments: [{ label: 'CPF', value: '123.456.789-00', maskKey: 'br-cpf' }],
      addressLines: [{ label: 'Cidade', value: 'Piedade', sortOrder: 0, maskKey: null }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts a client with empty identity documents and address lines arrays', () => {
    const result = clientSchema.safeParse({
      name: 'Maria Silva',
      phone: '11999999999',
      email: 'maria@example.com',
      identityDocuments: [],
      addressLines: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects an identity document with an empty label', () => {
    const result = clientSchema.safeParse({
      name: 'Maria Silva',
      phone: '11999999999',
      email: 'maria@example.com',
      identityDocuments: [{ label: '', value: '123' }],
      addressLines: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an address line missing sortOrder', () => {
    const result = clientSchema.safeParse({
      name: 'Maria Silva',
      phone: '11999999999',
      email: 'maria@example.com',
      identityDocuments: [],
      addressLines: [{ label: 'Cidade', value: 'Piedade' }],
    })
    expect(result.success).toBe(false)
  })
})
