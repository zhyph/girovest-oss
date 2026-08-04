import { describe, it, expect } from 'vitest'
import {
  isOccupiedForRange,
  derivedAvailability,
  maintenanceEndsOn,
  type AllocationWindow,
} from './occupancy.js'

describe('isOccupiedForRange', () => {
  it('blocks a new allocation whose range overlaps a reserved allocation', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'reserved',
        checkoutDate: new Date('2026-08-01'),
        actualCheckoutDate: null,
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
        actualCheckoutDate: null,
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
        actualCheckoutDate: null,
        dueDate: new Date('2026-08-05'),
        actualReturnDate: null,
      },
    ]
    // due_date (Aug 5) has passed; a request weeks later must still be blocked
    // because the dress has not actually come back.
    expect(
      isOccupiedForRange(allocations, new Date('2026-08-20'), new Date('2026-08-25'), {
        asOf: new Date('2026-08-10'),
      }),
    ).toBe(true)
  })

  it('lets a piece that is out on loan take a booking for dates after its due date', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'checked_out',
        checkoutDate: new Date('2026-08-01'),
        actualCheckoutDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-05'),
        actualReturnDate: null,
      },
    ]
    // The dress is with a customer today and comes back Aug 5. September is
    // free to sell: refusing it would make every rented piece unbookable for
    // the rest of the season.
    expect(
      isOccupiedForRange(allocations, new Date('2026-09-01'), new Date('2026-09-04'), {
        asOf: new Date('2026-08-03'),
      }),
    ).toBe(false)
  })

  it('still blocks dates inside the loan of a piece that is out', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'checked_out',
        checkoutDate: new Date('2026-08-01'),
        actualCheckoutDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-05'),
        actualReturnDate: null,
      },
    ]
    expect(
      isOccupiedForRange(allocations, new Date('2026-08-04'), new Date('2026-08-08'), {
        asOf: new Date('2026-08-03'),
      }),
    ).toBe(true)
  })

  it('treats a piece as free-from-its-due-date right up to the due date itself, not from midnight', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'checked_out',
        checkoutDate: new Date('2026-08-01'),
        actualCheckoutDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-05'),
        actualReturnDate: null,
      },
    ]
    // Mid-afternoon ON the due date is not yet overdue — the dress still has
    // the rest of the day to come back, so future dates stay sellable.
    expect(
      isOccupiedForRange(allocations, new Date('2026-09-01'), new Date('2026-09-04'), {
        asOf: new Date('2026-08-05T15:30:00Z'),
      }),
    ).toBe(false)
    // One day later with no return recorded, it is overdue and blocks again.
    expect(
      isOccupiedForRange(allocations, new Date('2026-09-01'), new Date('2026-09-04'), {
        asOf: new Date('2026-08-06T00:01:00Z'),
      }),
    ).toBe(true)
  })

  it('allows a new allocation once a checked_out allocation is cancelled', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'cancelled',
        checkoutDate: new Date('2026-08-01'),
        actualCheckoutDate: null,
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
        actualCheckoutDate: null,
        dueDate: new Date('2026-08-15'),
        actualReturnDate: null,
      },
    ]
    expect(isOccupiedForRange(allocations, new Date('2026-08-01'), new Date('2026-08-05'))).toBe(false)
  })

  it('blocks a new allocation that starts exactly on the reserved window due date (boundary touching)', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'reserved',
        checkoutDate: new Date('2026-08-01'),
        actualCheckoutDate: null,
        dueDate: new Date('2026-08-05'),
        actualReturnDate: null,
      },
    ]
    expect(isOccupiedForRange(allocations, new Date('2026-08-05'), new Date('2026-08-10'))).toBe(true)
  })

  it('allows a new allocation entirely after an existing reserved window with a gap', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'reserved',
        checkoutDate: new Date('2026-08-01'),
        actualCheckoutDate: null,
        dueDate: new Date('2026-08-05'),
        actualReturnDate: null,
      },
    ]
    expect(isOccupiedForRange(allocations, new Date('2026-08-10'), new Date('2026-08-15'))).toBe(false)
  })
})

describe('maintenance buffer', () => {
  const reservedAugust: AllocationWindow[] = [
    {
      status: 'reserved',
      checkoutDate: new Date('2026-08-01'),
      actualCheckoutDate: null,
      dueDate: new Date('2026-08-05'),
      actualReturnDate: null,
    },
  ]

  it('holds a piece back for the configured days after its due date', () => {
    // Due Aug 5, two cleaning days: Aug 6 and Aug 7 are blocked too.
    expect(
      isOccupiedForRange(reservedAugust, new Date('2026-08-07'), new Date('2026-08-09'), {
        maintenanceBufferDays: 2,
      }),
    ).toBe(true)
  })

  it('frees the piece the day after the cleaning window closes', () => {
    expect(
      isOccupiedForRange(reservedAugust, new Date('2026-08-08'), new Date('2026-08-10'), {
        maintenanceBufferDays: 2,
      }),
    ).toBe(false)
  })

  it('adds no cleaning window at all when the shop configured zero days', () => {
    expect(
      isOccupiedForRange(reservedAugust, new Date('2026-08-06'), new Date('2026-08-09'), {
        maintenanceBufferDays: 0,
      }),
    ).toBe(false)
  })

  it('opens the cleaning window from the ACTUAL return of an early return, not from the due date', () => {
    const returnedEarly: AllocationWindow[] = [
      {
        status: 'returned',
        checkoutDate: new Date('2026-08-01'),
        actualCheckoutDate: null,
        dueDate: new Date('2026-08-05'),
        actualReturnDate: new Date('2026-08-03T18:00:00Z'),
      },
    ]
    // Back on Aug 3, so cleaning runs Aug 4-5 and Aug 6 is sellable — the shop
    // gets the early days back instead of waiting out the original plan.
    expect(
      isOccupiedForRange(returnedEarly, new Date('2026-08-05'), new Date('2026-08-05'), {
        maintenanceBufferDays: 2,
      }),
    ).toBe(true)
    expect(
      isOccupiedForRange(returnedEarly, new Date('2026-08-06'), new Date('2026-08-08'), {
        maintenanceBufferDays: 2,
      }),
    ).toBe(false)
  })

  it('reports a piece inside its cleaning window as in maintenance, not as rented', () => {
    const returnedYesterday: AllocationWindow[] = [
      {
        status: 'returned',
        checkoutDate: new Date('2026-08-01'),
        actualCheckoutDate: null,
        dueDate: new Date('2026-08-05'),
        actualReturnDate: new Date('2026-08-05T10:00:00Z'),
      },
    ]
    expect(derivedAvailability(returnedYesterday, new Date('2026-08-06'), { maintenanceBufferDays: 2 })).toBe(
      'maintenance',
    )
    expect(derivedAvailability(returnedYesterday, new Date('2026-08-08'), { maintenanceBufferDays: 2 })).toBe(
      'available',
    )
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
        actualCheckoutDate: null,
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
        actualCheckoutDate: null,
        dueDate: new Date('2026-08-05'),
        actualReturnDate: null,
      },
    ]
    expect(derivedAvailability(allocations, new Date('2026-08-03'))).toBe('reserved')
  })
})

describe('early check-out occupancy', () => {
  it('CRITICAL: an early check-out occupies the dress from the actual pickup, not from the planned checkout date', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'checked_out',
        checkoutDate: new Date('2026-08-10'),
        actualCheckoutDate: new Date('2026-08-03'),
        dueDate: new Date('2026-08-15'),
        actualReturnDate: null,
      },
    ]
    // The dress physically left the store on Aug 3; the window between the
    // real pickup and the planned checkout date must not read as free.
    expect(isOccupiedForRange(allocations, new Date('2026-08-04'), new Date('2026-08-06'))).toBe(true)
  })

  it('reports a dress picked up early as rented on a date before its planned checkout date', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'checked_out',
        checkoutDate: new Date('2026-08-10'),
        actualCheckoutDate: new Date('2026-08-03'),
        dueDate: new Date('2026-08-15'),
        actualReturnDate: null,
      },
    ]
    expect(derivedAvailability(allocations, new Date('2026-08-05'))).toBe('rented')
  })

  it('falls back to the planned checkout date when no actual check-out instant was recorded', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'checked_out',
        checkoutDate: new Date('2026-08-10'),
        actualCheckoutDate: null,
        dueDate: new Date('2026-08-15'),
        actualReturnDate: null,
      },
    ]
    expect(isOccupiedForRange(allocations, new Date('2026-08-04'), new Date('2026-08-06'))).toBe(false)
    expect(derivedAvailability(allocations, new Date('2026-08-05'))).toBe('available')
  })

  it('never shrinks occupancy when the dress was picked up LATE — the reserved days stay blocked', () => {
    const allocations: AllocationWindow[] = [
      {
        status: 'checked_out',
        checkoutDate: new Date('2026-08-10'),
        actualCheckoutDate: new Date('2026-08-12'),
        dueDate: new Date('2026-08-15'),
        actualReturnDate: null,
      },
    ]
    expect(isOccupiedForRange(allocations, new Date('2026-08-10'), new Date('2026-08-11'))).toBe(true)
    expect(derivedAvailability(allocations, new Date('2026-08-11'))).toBe('rented')
  })
})

describe('whole-day comparison against a real clock time', () => {
  // Every production caller passes `new Date()`, which carries a wall-clock
  // time, while every window bound is a UTC-midnight calendar day. These pin
  // the boundary: the answer must not change part-way through a day.
  const returnedAug1: AllocationWindow[] = [
    {
      status: 'returned',
      checkoutDate: new Date('2026-07-20'),
      actualCheckoutDate: null,
      dueDate: new Date('2026-08-01'),
      actualReturnDate: new Date('2026-08-01T09:00:00Z'),
    },
  ]

  it('keeps a piece in cleaning for the whole of its window\'s LAST day', () => {
    // Back Aug 1 with a 3-day buffer: cleaning runs Aug 2-4, so Aug 4 is still
    // a cleaning day from its first second to its last, and Aug 5 is free.
    for (const instant of ['2026-08-04T00:00:00Z', '2026-08-04T14:32:00Z', '2026-08-04T23:59:59Z']) {
      expect(derivedAvailability(returnedAug1, new Date(instant), { maintenanceBufferDays: 3 })).toBe(
        'maintenance',
      )
    }
    expect(
      derivedAvailability(returnedAug1, new Date('2026-08-05T00:00:00Z'), { maintenanceBufferDays: 3 }),
    ).toBe('available')
  })

  it('reports the same cleaning end-date at any clock time on that last day', () => {
    for (const instant of ['2026-08-04T00:00:00Z', '2026-08-04T14:32:00Z', '2026-08-04T23:59:59Z']) {
      expect(maintenanceEndsOn(returnedAug1, new Date(instant), { maintenanceBufferDays: 3 })?.toISOString()).toBe(
        new Date('2026-08-04').toISOString(),
      )
    }
    expect(maintenanceEndsOn(returnedAug1, new Date('2026-08-05T00:00:00Z'), { maintenanceBufferDays: 3 })).toBe(
      null,
    )
  })

  it('keeps a piece rented for the whole of the day it is due back', () => {
    const dueToday: AllocationWindow[] = [
      {
        status: 'checked_out',
        checkoutDate: new Date('2026-08-01'),
        actualCheckoutDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-05'),
        actualReturnDate: null,
      },
    ]
    // The dress is physically with a customer until they walk back in; it must
    // not read as available from midnight on the due date itself.
    expect(derivedAvailability(dueToday, new Date('2026-08-05T16:45:00Z'))).toBe('rented')
  })

  it('keeps a reserved piece reserved for the whole of its last booked day', () => {
    const reserved: AllocationWindow[] = [
      {
        status: 'reserved',
        checkoutDate: new Date('2026-08-01'),
        actualCheckoutDate: null,
        dueDate: new Date('2026-08-05'),
        actualReturnDate: null,
      },
    ]
    expect(derivedAvailability(reserved, new Date('2026-08-05T16:45:00Z'))).toBe('reserved')
  })
})
