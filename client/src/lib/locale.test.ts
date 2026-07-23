import { describe, it, expect } from 'vitest'
import { DEFAULT_LOCALE, getLocaleConfig } from './locale.ts'

describe('getLocaleConfig', () => {
  it('returns the pt-BR config for "pt-BR"', () => {
    const config = getLocaleConfig('pt-BR')
    expect(config.currency).toBe('BRL')
  })

  it('falls back to pt-BR for an unregistered locale', () => {
    const config = getLocaleConfig('xx-YY')
    expect(config.currency).toBe('BRL')
  })

  it('falls back to pt-BR for undefined', () => {
    const config = getLocaleConfig(undefined)
    expect(config.currency).toBe('BRL')
  })

  it('DEFAULT_LOCALE is pt-BR', () => {
    expect(DEFAULT_LOCALE).toBe('pt-BR')
  })

  describe('pt-BR date formatting', () => {
    const { date } = getLocaleConfig('pt-BR')

    it('formats digits as a partial DD/MM/AAAA mask while typing', () => {
      expect(date.formatDigits('23')).toBe('23')
      expect(date.formatDigits('2308')).toBe('23/08')
      expect(date.formatDigits('23082026')).toBe('23/08/2026')
    })

    it('converts 8 digits (ddmmyyyy) to an ISO yyyy-mm-dd string', () => {
      expect(date.digitsToIso('23082026')).toBe('2026-08-23')
    })

    it('returns an empty string for fewer than 8 digits', () => {
      expect(date.digitsToIso('230820')).toBe('')
    })

    it('converts an ISO yyyy-mm-dd string back to ddmmyyyy digits', () => {
      expect(date.isoToDigits('2026-08-23')).toBe('23082026')
    })

    it('placeholder is DD/MM/AAAA', () => {
      expect(date.placeholder).toBe('DD/MM/AAAA')
    })
  })

  describe('pt-BR phone formatting', () => {
    const { phone } = getLocaleConfig('pt-BR')

    it('formats an 11-digit mobile number as (DDD) NNNNN-NNNN', () => {
      expect(phone.format('11987654321')).toBe('(11) 98765-4321')
    })

    it('formats a 10-digit landline number as (DDD) NNNN-NNNN', () => {
      expect(phone.format('1132654321')).toBe('(11) 3265-4321')
    })
  })
})
