import { describe, it, expect } from 'vitest'
import { getMissingRequiredFields } from './clientReadiness.ts'
import type { Client } from '../features/clients/clientSchemas.ts'

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 'c1',
    name: 'Maria',
    phone: '1',
    email: 'a@example.com',
    notes: '',
    identityDocuments: [],
    addressLines: [],
    hasAllocationHistory: false,
    createdAt: '2026-01-01',
    contractCount: 0,
    lastRentalProductId: null,
    lastRentalDate: null,
    ...overrides,
  }
}

describe('getMissingRequiredFields', () => {
  it('lists every required pt-BR field when the client has none of them', () => {
    const missing = getMissingRequiredFields(makeClient(), 'pt-BR')
    expect(missing).toEqual(['CPF', 'RG', 'Endereço', 'Bairro', 'Cidade', 'Estado'])
  })

  it('excludes fields that are present with a non-empty value', () => {
    const client = makeClient({
      identityDocuments: [
        { id: 'd1', label: 'CPF', value: '123.456.789-00', maskKey: 'br-cpf' },
        { id: 'd2', label: 'RG', value: '12.345.678-9', maskKey: 'br-rg' },
      ],
      addressLines: [
        { id: 'a1', label: 'Endereço', value: 'Rua X, 1', sortOrder: 0, maskKey: null },
      ],
    })
    expect(getMissingRequiredFields(client, 'pt-BR')).toEqual(['Bairro', 'Cidade', 'Estado'])
  })

  it('still counts a field as missing when the row exists but its value is blank', () => {
    const client = makeClient({
      identityDocuments: [{ id: 'd1', label: 'CPF', value: '', maskKey: 'br-cpf' }],
    })
    expect(getMissingRequiredFields(client, 'pt-BR')).toContain('CPF')
  })

  it('returns an empty list when every required field is present and filled', () => {
    const client = makeClient({
      identityDocuments: [
        { id: 'd1', label: 'CPF', value: '123.456.789-00', maskKey: 'br-cpf' },
        { id: 'd2', label: 'RG', value: '12.345.678-9', maskKey: 'br-rg' },
      ],
      addressLines: [
        { id: 'a1', label: 'Endereço', value: 'Rua X, 1', sortOrder: 0, maskKey: null },
        { id: 'a2', label: 'Bairro', value: 'Centro', sortOrder: 1, maskKey: null },
        { id: 'a3', label: 'Cidade', value: 'Piedade', sortOrder: 2, maskKey: null },
        { id: 'a4', label: 'Estado', value: 'SP', sortOrder: 3, maskKey: null },
      ],
    })
    expect(getMissingRequiredFields(client, 'pt-BR')).toEqual([])
  })
})
