import { describe, it, expect } from 'vitest'
import { parseDateOnly } from './date.ts'

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
