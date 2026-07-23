import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { isOccupiedForRange, derivedAvailability, type AllocationWindow, type AllocationStatus } from '../domain/occupancy.js'

const ACTIVE_STATUSES: AllocationStatus[] = ['reserved', 'checked_out']

function toWindow(allocation: { status: string; checkoutDate: Date; dueDate: Date; actualReturnDate: Date | null }): AllocationWindow {
  return {
    status: allocation.status as AllocationStatus,
    checkoutDate: allocation.checkoutDate,
    dueDate: allocation.dueDate,
    actualReturnDate: allocation.actualReturnDate,
  }
}

async function getAllocationOrThrow(id: string) {
  const allocation = await prisma.allocation.findUnique({ where: { id } })
  if (!allocation) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Allocation ${id} not found`)
  }
  return allocation
}

export interface CheckOutInput {
  conditionNotesOut?: string
  depositCollected?: number
}

export async function checkOutAllocation(id: string, data: CheckOutInput, asOf: Date = new Date()) {
  const allocation = await getAllocationOrThrow(id)
  if (allocation.status !== 'reserved') {
    throw new AppError(
      ErrorCodes.INVALID_ALLOCATION_TRANSITION,
      409,
      `Cannot check out an allocation with status ${allocation.status}`,
    )
  }
  if (asOf.getTime() < allocation.checkoutDate.getTime()) {
    throw new AppError(
      ErrorCodes.CHECKOUT_TOO_EARLY,
      409,
      'Cannot check out before the allocation\'s checkout date',
    )
  }
  const result = await prisma.allocation.updateMany({
    where: { id, status: 'reserved' },
    data: {
      status: 'checked_out',
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

export async function returnAllocation(id: string, data: ReturnInput) {
  const allocation = await getAllocationOrThrow(id)
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

export async function cancelAllocation(id: string) {
  const allocation = await getAllocationOrThrow(id)
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

export async function getProductAvailability(productId: string, asOf: Date = new Date()) {
  const allocations = await prisma.allocation.findMany({
    where: { productId, status: { in: ACTIVE_STATUSES } },
  })
  return derivedAvailability(allocations.map(toWindow), asOf)
}

export async function isProductAvailableForRange(productId: string, checkoutDate: Date, dueDate: Date) {
  const allocations = await prisma.allocation.findMany({
    where: { productId, status: { in: ACTIVE_STATUSES } },
  })
  return !isOccupiedForRange(allocations.map(toWindow), checkoutDate, dueDate)
}

export async function listAllocations() {
  return prisma.allocation.findMany({ orderBy: { createdAt: 'desc' } })
}
