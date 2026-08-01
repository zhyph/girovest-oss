import { prisma } from '../db/client.js'
import { scopedDb } from '../db/scopedClient.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { isOccupiedForRange, derivedAvailability } from '../domain/occupancy.js'
import {
  blockingAllocationsWhere,
  loadBlockingWindows,
  maintenanceBufferForProduct,
  toWindow,
} from './occupancyQuery.js'

// Allocation has no locationId column of its own — location is reached via
// the product relation. This is the one join scopedDb can't cover (it only
// intercepts top-level delegate calls), so every function here checks
// ownership explicitly, matching contractService.ts's existing pattern.
async function getAllocationOrThrow(locationId: string, id: string) {
  const allocation = await prisma.allocation.findUnique({ where: { id }, include: { product: true } })
  if (!allocation || allocation.product.locationId !== locationId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Allocation ${id} not found`)
  }
  return allocation
}

export interface CheckOutInput {
  conditionNotesOut?: string
  depositCollected?: number
  /**
   * Deliberate override of the "not before the checkout date" block, set only
   * when the operator confirmed the early pickup. Never persisted.
   */
  allowEarly?: boolean
}

export async function checkOutAllocation(
  locationId: string,
  id: string,
  data: CheckOutInput,
  asOf: Date = new Date(),
) {
  const allocation = await getAllocationOrThrow(locationId, id)
  if (allocation.status !== 'reserved') {
    throw new AppError(
      ErrorCodes.INVALID_ALLOCATION_TRANSITION,
      409,
      `Cannot check out an allocation with status ${allocation.status}`,
    )
  }
  if (!data.allowEarly && asOf.getTime() < allocation.checkoutDate.getTime()) {
    throw new AppError(
      ErrorCodes.CHECKOUT_TOO_EARLY,
      409,
      'Cannot check out before the allocation\'s checkout date',
    )
  }
  if (asOf.getTime() < allocation.checkoutDate.getTime()) {
    // Leaving early does not just move a date — it claims the days between now
    // and the contracted pickup, days nobody checked when this allocation was
    // created. If another booking already holds them, confirming the override
    // would promise one physical dress to two customers, so this block is NOT
    // overridable: only moving the other booking can clear it.
    const maintenanceBufferDays = await maintenanceBufferForProduct(allocation.productId)
    const others = await prisma.allocation.findMany({
      where: {
        ...blockingAllocationsWhere([allocation.productId], maintenanceBufferDays, asOf),
        id: { not: allocation.id },
      },
    })
    if (
      isOccupiedForRange(others.map(toWindow), asOf, allocation.checkoutDate, { asOf, maintenanceBufferDays })
    ) {
      throw new AppError(
        ErrorCodes.EARLY_CHECKOUT_CONFLICT,
        409,
        'Another allocation holds this product between now and its checkout date',
      )
    }
  }
  const result = await prisma.allocation.updateMany({
    where: { id, status: 'reserved' },
    data: {
      status: 'checked_out',
      // Always recorded, not just for early pickups: occupancy derives the
      // real occupied range from it, and a late pickup must not shrink it.
      actualCheckoutDate: asOf,
      conditionNotesOut: data.conditionNotesOut,
      depositCollected: data.depositCollected,
    },
  })
  if (result.count === 0) {
    throw new AppError(
      ErrorCodes.INVALID_ALLOCATION_TRANSITION,
      409,
      'Allocation status changed concurrently; refresh and try again',
    )
  }
  return prisma.allocation.findUniqueOrThrow({ where: { id } })
}

export interface ReturnInput {
  conditionNotesIn?: string
  depositReturned?: number
  actualReturnDate?: Date
}

export async function returnAllocation(locationId: string, id: string, data: ReturnInput) {
  const allocation = await getAllocationOrThrow(locationId, id)
  if (allocation.status !== 'checked_out') {
    throw new AppError(
      ErrorCodes.INVALID_ALLOCATION_TRANSITION,
      409,
      `Cannot return an allocation with status ${allocation.status}`,
    )
  }
  const result = await prisma.allocation.updateMany({
    where: { id, status: 'checked_out' },
    data: {
      status: 'returned',
      actualReturnDate: data.actualReturnDate ?? new Date(),
      conditionNotesIn: data.conditionNotesIn,
      depositReturned: data.depositReturned,
    },
  })
  if (result.count === 0) {
    throw new AppError(
      ErrorCodes.INVALID_ALLOCATION_TRANSITION,
      409,
      'Allocation status changed concurrently; refresh and try again',
    )
  }
  return prisma.allocation.findUniqueOrThrow({ where: { id } })
}

export async function cancelAllocation(locationId: string, id: string) {
  const allocation = await getAllocationOrThrow(locationId, id)
  if (allocation.status !== 'reserved') {
    throw new AppError(
      ErrorCodes.INVALID_ALLOCATION_TRANSITION,
      409,
      `Cannot cancel an allocation with status ${allocation.status}`,
    )
  }
  const result = await prisma.allocation.updateMany({
    where: { id, status: 'reserved' },
    data: { status: 'cancelled' },
  })
  if (result.count === 0) {
    throw new AppError(
      ErrorCodes.INVALID_ALLOCATION_TRANSITION,
      409,
      'Allocation status changed concurrently; refresh and try again',
    )
  }
  return prisma.allocation.findUniqueOrThrow({ where: { id } })
}

// occupancyQuery.ts's helpers trust whatever productId they're handed with no
// location check of their own by design — these two functions are the
// callers responsible for verifying ownership first.
async function assertProductInLocation(locationId: string, productId: string): Promise<void> {
  const product = await scopedDb(locationId).product.findUnique({ where: { id: productId } })
  if (!product) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${productId} not found`)
  }
}

export async function getProductAvailability(locationId: string, productId: string, asOf: Date = new Date()) {
  await assertProductInLocation(locationId, productId)
  const maintenanceBufferDays = await maintenanceBufferForProduct(productId)
  const windows = await loadBlockingWindows([productId], maintenanceBufferDays, asOf)
  return derivedAvailability(windows, asOf, { maintenanceBufferDays })
}

export async function isProductAvailableForRange(
  locationId: string,
  productId: string,
  checkoutDate: Date,
  dueDate: Date,
) {
  await assertProductInLocation(locationId, productId)
  const maintenanceBufferDays = await maintenanceBufferForProduct(productId)
  const windows = await loadBlockingWindows([productId], maintenanceBufferDays, checkoutDate)
  return !isOccupiedForRange(windows, checkoutDate, dueDate, { maintenanceBufferDays })
}

export async function listAllocations(locationId: string) {
  return prisma.allocation.findMany({
    where: { product: { locationId } },
    orderBy: { createdAt: 'desc' },
  })
}
