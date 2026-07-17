import { describe, it, expect } from 'vitest'
import { isOccupiedForRange, derivedAvailability, type AllocationWindow } from './occupancy.js'

describe('isOccupiedForRange', () => {
  it('blocks a new allocation whose range overlaps a reserved allocation', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'reserved',
        checkoutDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-05'),
        actualReturnDate: null,
      },
    ]
    expect(isOccupiedForRange(allocations, new Date('2026-08-03'), new Date('2026-08-10'))).toBe(true)
  })

  it('allows a new allocation once the old one is returned, even if dates would have overlapped', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'returned',
        checkoutDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-05'),
        actualReturnDate: new Date('2026-08-04'),
      },
    ]
    expect(isOccupiedForRange(allocations, new Date('2026-08-03'), new Date('2026-08-10'))).toBe(false)
  })

  it('CRITICAL: a checked_out allocation past its due date still blocks any future date until returned', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'checked_out',
        checkoutDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-05'),
        actualReturnDate: null,
      },
    ]
    // due_date (Aug 5) has passed; a request weeks later must still be blocked
    // because the dress has not actually come back.
    expect(isOccupiedForRange(allocations, new Date('2026-08-20'), new Date('2026-08-25'))).toBe(true)
  })

  it('allows a new allocation once a checked_out allocation is cancelled', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'cancelled',
        checkoutDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-05'),
        actualReturnDate: null,
      },
    ]
    expect(isOccupiedForRange(allocations, new Date('2026-08-03'), new Date('2026-08-10'))).toBe(false)
  })

  it('allows a new allocation entirely before an existing reserved window', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'reserved',
        checkoutDate: new Date('2026-08-10'),
        dueDate: new Date('2026-08-15'),
        actualReturnDate: null,
      },
    ]
    expect(isOccupiedForRange(allocations, new Date('2026-08-01'), new Date('2026-08-05'))).toBe(false)
  })
})

describe('derivedAvailability', () => {
  it('is available when nothing occupies the given date', () => {
    expect(derivedAvailability([], new Date('2026-08-03'))).toBe('available')
  })

  it('is rented when a checked_out allocation occupies the given date, even past its due date', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'checked_out',
        checkoutDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-05'),
        actualReturnDate: null,
      },
    ]
    expect(derivedAvailability(allocations, new Date('2026-08-20'))).toBe('rented')
  })

  it('is reserved when only a reserved allocation occupies the given date', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'reserved',
        checkoutDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-05'),
        actualReturnDate: null,
      },
    ]
    expect(derivedAvailability(allocations, new Date('2026-08-03'))).toBe('reserved')
  })
})
