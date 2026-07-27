import { prisma } from '../db/client.js'
import type { AllocationStatus, AllocationWindow } from '../domain/occupancy.js'

/** Statuses that hold a piece regardless of how the shop configured cleaning. */
const HELD_STATUSES: AllocationStatus[] = ['reserved', 'checked_out']

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function toWindow(allocation: {
  status: string
  checkoutDate: Date
  actualCheckoutDate: Date | null
  dueDate: Date
  actualReturnDate: Date | null
}): AllocationWindow {
  return {
    status: allocation.status as AllocationStatus,
    checkoutDate: allocation.checkoutDate,
    actualCheckoutDate: allocation.actualCheckoutDate,
    dueDate: allocation.dueDate,
    actualReturnDate: allocation.actualReturnDate,
  }
}

export async function maintenanceBufferForLocation(locationId: string): Promise<number> {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { maintenanceBufferDays: true },
  })
  return location?.maintenanceBufferDays ?? 0
}

export async function maintenanceBufferForProduct(productId: string): Promise<number> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { location: { select: { maintenanceBufferDays: true } } },
  })
  return product?.location.maintenanceBufferDays ?? 0
}

/**
 * The Prisma filter for every allocation that can still block `productIds` on
 * or after `from`.
 *
 * A returned allocation used to be pure history — the piece was back, so it
 * blocked nothing. With a cleaning buffer configured it keeps blocking for a
 * few more days, so those rows have to be loaded too. Returned rows accumulate
 * for the life of the shop, so they are cut down to the only ones whose
 * cleaning window can still reach `from`; without that bound every availability
 * check would drag in the product's entire rental history.
 */
export function blockingAllocationsWhere(productIds: string[], bufferDays: number, from: Date) {
  const cleaningCouldStillCover = new Date(from.getTime() - bufferDays * MS_PER_DAY)
  return {
    productId: { in: productIds },
    OR: [
      { status: { in: HELD_STATUSES } },
      ...(bufferDays > 0
        ? [{ status: 'returned', actualReturnDate: { gte: cleaningCouldStillCover } }]
        : []),
    ],
  }
}

export async function loadBlockingWindows(
  productIds: string[],
  bufferDays: number,
  from: Date,
): Promise<AllocationWindow[]> {
  if (productIds.length === 0) return []
  const allocations = await prisma.allocation.findMany({
    where: blockingAllocationsWhere(productIds, bufferDays, from),
  })
  return allocations.map(toWindow)
}
