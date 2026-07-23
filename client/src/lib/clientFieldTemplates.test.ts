import { describe, it, expect } from 'vitest'
import { getClientFieldTemplate } from './clientFieldTemplates.ts'

describe('getClientFieldTemplate', () => {
  it('returns the pt-BR template with CPF and RG identity documents', () => {
    const template = getClientFieldTemplate('pt-BR')
    expect(template.identityDocuments).toEqual([
      { label: 'CPF', maskKey: 'br-cpf', required: true },
      { label: 'RG', maskKey: 'br-rg', required: true },
    ])
  })

  it('returns the pt-BR template with the four required address lines in order', () => {
    const template = getClientFieldTemplate('pt-BR')
    expect(template.addressLines).toEqual([
      { label: 'Endereço', required: true },
      { label: 'Bairro', required: true },
      { label: 'Cidade', required: true },
      { label: 'Estado', required: true },
    ])
  })

  it('falls back to pt-BR for an unregistered locale', () => {
    const template = getClientFieldTemplate('xx-YY')
    expect(template.identityDocuments).toHaveLength(2)
  })

  it('falls back to pt-BR for undefined', () => {
    const template = getClientFieldTemplate(undefined)
    expect(template.identityDocuments).toHaveLength(2)
  })
})
