export type AllocationStatus = 'reserved' | 'checked_out' | 'returned' | 'cancelled'

export interface AllocationWindow {
  status: AllocationStatus
  /** The planned, contracted pickup date — never overwritten by what actually happened. */
  checkoutDate: Date
  /** When the dress physically left the store; null when it was never recorded. */
  actualCheckoutDate: Date | null
  dueDate: Date
  actualReturnDate: Date | null
}

export interface OccupancyOptions {
  /**
   * "Now". Decides whether a checked_out allocation is merely running (its
   * planned return is still ahead) or overdue (it should already be back and
   * is not). Only the calendar day matters, never the clock time.
   */
  asOf?: Date
  /**
   * Days a piece is held back for cleaning and repairs once it returns, on top
   * of the rental itself. 0 restores the original behaviour.
   */
  maintenanceBufferDays?: number
}

interface Occupancy {
  /** Days a customer physically holds the piece. `end: null` means "still out, return date unknown". */
  rental: { start: Date; end: Date | null } | null
  /** Days the piece is back but not yet re-rentable. Always bounded. */
  maintenance: { start: Date; end: Date } | null
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Allocation dates are stored as UTC midnight (date-only strings), but `asOf`
 * and `actualReturnDate` carry a real wall-clock time. Comparing them raw would
 * make a piece read as overdue from the first second of its own due date, so
 * every comparison here happens on whole UTC days.
 */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addDays(date: Date, days: number): Date {
  return new Date(startOfUtcDay(date).getTime() + days * MS_PER_DAY)
}

/**
 * The window a piece is unavailable for, split into the part a customer holds
 * it and the part the shop spends cleaning it. A booking attempt cannot tell
 * the two apart, but the product list shows them differently.
 */
function occupancyOf(allocation: AllocationWindow, asOf: Date, bufferDays: number): Occupancy {
  const cleaningAfter = (returnDay: Date): Occupancy['maintenance'] =>
    bufferDays > 0 ? { start: addDays(returnDay, 1), end: addDays(returnDay, bufferDays) } : null

  switch (allocation.status) {
    case 'reserved':
      return {
        rental: { start: allocation.checkoutDate, end: allocation.dueDate },
        maintenance: cleaningAfter(allocation.dueDate),
      }
    case 'checked_out': {
      // Occupancy starts the moment the dress actually left the store, so an
      // early check-out does not leave [actual pickup, planned checkout) free
      // for someone else to book. A LATE pickup must not shrink occupancy
      // either — the reserved days were still blocked — hence the earlier of
      // the two.
      const start =
        allocation.actualCheckoutDate && allocation.actualCheckoutDate.getTime() < allocation.checkoutDate.getTime()
          ? allocation.actualCheckoutDate
          : allocation.checkoutDate
      // Past its due date and still not back: nobody can say when it returns,
      // so it blocks every date ahead rather than pretending the planned
      // return still holds. A late return is a real physical conflict.
      if (startOfUtcDay(asOf).getTime() > startOfUtcDay(allocation.dueDate).getTime()) {
        return { rental: { start, end: null }, maintenance: null }
      }
      // Still within plan: the piece frees up after its due date exactly like a
      // reservation does. Blocking every future date merely because the dress
      // is out today would make it unbookable for the rest of the season.
      return { rental: { start, end: allocation.dueDate }, maintenance: cleaningAfter(allocation.dueDate) }
    }
    case 'returned':
      // The rental itself no longer blocks anything — the piece is physically
      // back, and dates it used to cover are free again. Only the cleaning
      // window that its return opened still blocks.
      return {
        rental: null,
        maintenance: allocation.actualReturnDate ? cleaningAfter(allocation.actualReturnDate) : null,
      }
    case 'cancelled':
      return { rental: null, maintenance: null }
  }
}

function rangesOverlap(aStart: Date, aEnd: Date | null, bStart: Date, bEnd: Date | null): boolean {
  const aEndTime = aEnd ? aEnd.getTime() : Number.POSITIVE_INFINITY
  const bEndTime = bEnd ? bEnd.getTime() : Number.POSITIVE_INFINITY
  return aStart.getTime() <= bEndTime && bStart.getTime() <= aEndTime
}

function blocksRange(occupancy: Occupancy, start: Date, end: Date): boolean {
  if (occupancy.rental && rangesOverlap(occupancy.rental.start, occupancy.rental.end, start, end)) return true
  if (occupancy.maintenance && rangesOverlap(occupancy.maintenance.start, occupancy.maintenance.end, start, end)) {
    return true
  }
  return false
}

export function isOccupiedForRange(
  allocations: AllocationWindow[],
  requestedStart: Date,
  requestedEnd: Date,
  { asOf = new Date(), maintenanceBufferDays = 0 }: OccupancyOptions = {},
): boolean {
  return allocations.some((allocation) =>
    blocksRange(occupancyOf(allocation, asOf, maintenanceBufferDays), requestedStart, requestedEnd),
  )
}

export type DerivedAvailability = 'available' | 'reserved' | 'rented' | 'maintenance'

export function derivedAvailability(
  allocations: AllocationWindow[],
  asOf: Date,
  { maintenanceBufferDays = 0 }: Pick<OccupancyOptions, 'maintenanceBufferDays'> = {},
): DerivedAvailability {
  const today = allocations.map((allocation) => ({
    status: allocation.status,
    occupancy: occupancyOf(allocation, asOf, maintenanceBufferDays),
  }))

  // Worst news wins: a piece that is out today reads as "rented" even if some
  // other allocation would only call it reserved or in cleaning.
  const heldByCustomer = today.filter(
    ({ occupancy }) => occupancy.rental && rangesOverlap(occupancy.rental.start, occupancy.rental.end, asOf, asOf),
  )
  if (heldByCustomer.some(({ status }) => status === 'checked_out')) return 'rented'
  if (heldByCustomer.length > 0) return 'reserved'

  const beingCleaned = today.some(
    ({ occupancy }) =>
      occupancy.maintenance && rangesOverlap(occupancy.maintenance.start, occupancy.maintenance.end, asOf, asOf),
  )
  return beingCleaned ? 'maintenance' : 'available'
}

/**
 * The last day a piece stays held for cleaning, for a piece that is in its
 * cleaning window on `asOf` — `null` for anything else, including a piece a
 * customer is holding today (a rental outranks cleaning in
 * `derivedAvailability`, and a dress that is out of the shop is not "coming
 * out of cleaning" no matter what an older allocation's buffer says).
 *
 * The latest end among the windows covering today wins: two returns close
 * together each open their own cleaning window, and the piece is only free
 * once the last one closes.
 */
export function maintenanceEndsOn(
  allocations: AllocationWindow[],
  asOf: Date,
  { maintenanceBufferDays = 0 }: Pick<OccupancyOptions, 'maintenanceBufferDays'> = {},
): Date | null {
  if (derivedAvailability(allocations, asOf, { maintenanceBufferDays }) !== 'maintenance') return null

  const endsCoveringToday = allocations
    .map((allocation) => occupancyOf(allocation, asOf, maintenanceBufferDays).maintenance)
    .filter((window) => window !== null && rangesOverlap(window.start, window.end, asOf, asOf))
    .map((window) => window!.end.getTime())

  return endsCoveringToday.length === 0 ? null : new Date(Math.max(...endsCoveringToday))
}

/** UTC-day arithmetic, exported so callers can compare against a maintenance end. */
export function addUtcDays(date: Date, days: number): Date {
  return addDays(date, days)
}
