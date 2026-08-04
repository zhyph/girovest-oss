import { prisma } from '../db/client.js'
import { addUtcDays } from '../domain/occupancy.js'
import type { AllocationStatus, AllocationWindow } from '../domain/occupancy.js'

/** Statuses that hold a piece regardless of how the shop configured cleaning. */
const HELD_STATUSES: AllocationStatus[] = ['reserved', 'checked_out']

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
  // ast-grep-ignore: no-unscoped-location-model — Permanently unscoped: the function takes no locationId, since the point is to read the buffer of whichever location the product itself belongs to. Callers (productService/allocationService) location-check the productId first; the only thing returned is a buffer-days number, so it carries no cross-location data either way.
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
 *
 * The bound is whole UTC days, not raw instants, because that is the unit the
 * cleaning window itself is built in (`occupancyOf` runs every bound through
 * `addUtcDays`). Subtracting `bufferDays * 24h` from a `from` that carries a
 * clock time — which every production caller does, since `asOf` defaults to
 * `new Date()` — pushes the cut-off to that same clock time `bufferDays`
 * earlier, silently dropping every piece returned before it on that day. Those
 * are exactly the pieces whose window closes TODAY, so the Painel's "Saindo da
 * higienização" panel lost them on their last day.
 */
export function blockingAllocationsWhere(productIds: string[], bufferDays: number, from: Date) {
  const cleaningCouldStillCover = addUtcDays(from, -bufferDays)
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
