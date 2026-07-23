import { describe, it, expect } from 'vitest'
import { getFieldMask } from './clientFieldMasks.ts'

describe('getFieldMask', () => {
  it('formats a CPF as digits are typed', () => {
    const format = getFieldMask('br-cpf')!
    expect(format('123')).toBe('123')
    expect(format('123456')).toBe('123.456')
    expect(format('123456789')).toBe('123.456.789')
    expect(format('12345678900')).toBe('123.456.789-00')
  })

  it('ignores non-digit characters and caps at 11 digits for CPF', () => {
    const format = getFieldMask('br-cpf')!
    expect(format('123.456.789-00extra')).toBe('123.456.789-00')
  })

  it('formats an RG with the common grouping convention, allowing a trailing letter', () => {
    const format = getFieldMask('br-rg')!
    expect(format('12')).toBe('12')
    expect(format('12345')).toBe('12.345')
    expect(format('12345678')).toBe('12.345.678')
    expect(format('12345678X')).toBe('12.345.678-X')
  })

  it('returns undefined for an unknown maskKey', () => {
    expect(getFieldMask('unknown-key')).toBeUndefined()
  })

  it('returns undefined for a null or undefined maskKey', () => {
    expect(getFieldMask(null)).toBeUndefined()
    expect(getFieldMask(undefined)).toBeUndefined()
  })
})
