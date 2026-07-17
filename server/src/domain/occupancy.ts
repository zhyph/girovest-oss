export type AllocationStatus = 'reserved' | 'checked_out' | 'returned' | 'cancelled'

export interface AllocationWindow {
  status: AllocationStatus
  checkoutDate: Date
  dueDate: Date
  actualReturnDate: Date | null
}

interface OccupiedRange {
  start: Date
  /** null means occupied indefinitely (checked_out, not yet returned). */
  end: Date | null
}

function occupiedRange(allocation: AllocationWindow): OccupiedRange | null {
  switch (allocation.status) {
    case 'reserved':
      return { start: allocation.checkoutDate, end: allocation.dueDate }
    case 'checked_out':
      // Occupied until a return is actually recorded, not until due_date —
      // a late return is a real physical conflict, not a plan.
      return { start: allocation.checkoutDate, end: null }
    case 'returned':
    case 'cancelled':
      return null
  }
}

function rangesOverlap(aStart: Date, aEnd: Date | null, bStart: Date, bEnd: Date | null): boolean {
  const aEndTime = aEnd ? aEnd.getTime() : Number.POSITIVE_INFINITY
  const bEndTime = bEnd ? bEnd.getTime() : Number.POSITIVE_INFINITY
  return aStart.getTime() <= bEndTime && bStart.getTime() <= aEndTime
}

export function isOccupiedForRange(
  allocations: AllocationWindow[],
  requestedStart: Date,
  requestedEnd: Date,
): boolean {
  return allocations.some((allocation) => {
    const occupied = occupiedRange(allocation)
    if (!occupied) return false
    return rangesOverlap(occupied.start, occupied.end, requestedStart, requestedEnd)
  })
}

export type DerivedAvailability = 'available' | 'reserved' | 'rented'

export function derivedAvailability(allocations: AllocationWindow[], asOf: Date): DerivedAvailability {
  const occupiedToday = allocations.filter((allocation) => {
    const occupied = occupiedRange(allocation)
    if (!occupied) return false
    return rangesOverlap(occupied.start, occupied.end, asOf, asOf)
  })

  if (occupiedToday.length === 0) return 'available'
  if (occupiedToday.some((allocation) => allocation.status === 'checked_out')) return 'rented'
  return 'reserved'
}
