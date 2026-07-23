import { describe, it, expect } from 'vitest'
import { parseDateOnly, formatDate } from './date.ts'

describe('parseDateOnly', () => {
  it('keeps the calendar day intact regardless of the UTC suffix', () => {
    const date = parseDateOnly('2026-07-23T00:00:00.000Z')
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(6)
    expect(date.getDate()).toBe(23)
  })

  it('parses a bare YYYY-MM-DD string the same way', () => {
    const date = parseDateOnly('2026-01-05')
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(0)
    expect(date.getDate()).toBe(5)
  })
})

describe('formatDate', () => {
  it('formats a date using the given locale and options', () => {
    const date = new Date(2026, 7, 23)
    expect(formatDate(date, 'pt-BR', { day: '2-digit', month: '2-digit' })).toBe('23/08')
  })

  it('includes the year when asked', () => {
    const date = new Date(2026, 7, 23)
    expect(formatDate(date, 'pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })).toBe('23/08/2026')
  })
})
