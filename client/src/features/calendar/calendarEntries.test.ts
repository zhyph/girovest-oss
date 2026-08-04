import { describe, it, expect } from 'vitest'
import { buildEntries, dayKey, type AllocationsByKind } from './calendarEntries.ts'
import type { Allocation } from '../allocations/allocationSchemas.ts'

function makeAllocation(overrides: Partial<Allocation> = {}): Allocation {
  return {
    id: 'a1', productId: 'p1', clientId: 'c1', staffId: 's1',
    checkoutDate: '2026-07-01', actualCheckoutDate: null, dueDate: '2026-07-05',
    actualReturnDate: null, status: 'reserved', priceCharged: 100,
    depositCollected: null, depositReturned: null, conditionNotesOut: null, conditionNotesIn: null,
    createdAt: '2026-07-01',
    ...overrides,
  }
}

const empty: AllocationsByKind = { 'going-out': [], 'due-back': [], overdue: [] }

describe('buildEntries', () => {
  it('puts the same allocation on both its checkout day and its due day under "Tudo"', () => {
    const allocation = makeAllocation({ id: 'a1', checkoutDate: '2026-07-03', dueDate: '2026-07-10' })
    const entries = buildEntries(
      { ...empty, 'going-out': [allocation], 'due-back': [allocation] },
      'all',
    )

    expect(entries.map((entry) => [entry.kind, entry.date.getDate()])).toEqual([
      ['going-out', 3],
      ['due-back', 10],
    ])
    // Both rows describe the same allocation, so the id alone cannot key them.
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(2)
  })

  it('counts a late piece as atrasado only, never also as voltando, under "Tudo"', () => {
    const late = makeAllocation({ id: 'late', dueDate: '2026-07-02' })
    const onTime = makeAllocation({ id: 'on-time', dueDate: '2026-07-20' })
    const entries = buildEntries(
      { ...empty, 'due-back': [late, onTime], overdue: [late] },
      'all',
    )

    expect(entries.map((entry) => `${entry.kind}:${entry.allocation.id}`)).toEqual([
      'due-back:on-time',
      'overdue:late',
    ])
  })

  it('keeps the full due-back set when "Voltando" is picked on its own', () => {
    const late = makeAllocation({ id: 'late', dueDate: '2026-07-02' })
    const entries = buildEntries({ ...empty, 'due-back': [late], overdue: [late] }, 'due-back')

    // Narrowing to Voltando must not quietly hide pieces the server does have
    // due back; the deduplication exists only to stop "Tudo" double counting.
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe('due-back')
  })

  it('reads the day from checkoutDate for going-out and dueDate for the rest', () => {
    const allocation = makeAllocation({ checkoutDate: '2026-07-03', dueDate: '2026-07-10' })
    expect(buildEntries({ ...empty, 'going-out': [allocation] }, 'going-out')[0].date.getDate()).toBe(3)
    expect(buildEntries({ ...empty, overdue: [allocation] }, 'overdue')[0].date.getDate()).toBe(10)
  })
})

describe('dayKey', () => {
  it('separates the same day number in different months and years', () => {
    expect(dayKey(new Date(2026, 6, 5))).not.toBe(dayKey(new Date(2026, 7, 5)))
    expect(dayKey(new Date(2026, 6, 5))).not.toBe(dayKey(new Date(2027, 6, 5)))
    expect(dayKey(new Date(2026, 6, 5, 23, 59))).toBe(dayKey(new Date(2026, 6, 5, 0, 0)))
  })
})
