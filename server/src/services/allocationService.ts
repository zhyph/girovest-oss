import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { isOccupiedForRange, derivedAvailability, type AllocationWindow, type AllocationStatus } from '../domain/occupancy.js'

const MAX_WRITE_CONFLICT_RETRIES = 5
const ACTIVE_STATUSES: AllocationStatus[] = ['reserved', 'checked_out']

export interface CreateAllocationInput {
  productId: string
  clientId: string
  staffId: string
  checkoutDate: Date
  dueDate: Date
  priceCharged: number
}

function toWindow(allocation: { status: string; checkoutDate: Date; dueDate: Date; actualReturnDate: Date | null }): AllocationWindow {
  return {
    status: allocation.status as AllocationStatus,
    checkoutDate: allocation.checkoutDate,
    dueDate: allocation.dueDate,
    actualReturnDate: allocation.actualReturnDate,
  }
}

export async function createAllocation(input: CreateAllocationInput) {
  if (input.dueDate.getTime() < input.checkoutDate.getTime()) {
    throw new AppError(ErrorCodes.DUE_DATE_BEFORE_CHECKOUT, 400, 'Due date must be on or after checkout date')
  }

  const useSerializable = process.env.DB_PROVIDER === 'postgresql'

  for (let attempt = 0; attempt < MAX_WRITE_CONFLICT_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.allocation.findMany({
            where: { productId: input.productId, status: { in: ACTIVE_STATUSES } },
          })

          const windows = existing.map(toWindow)

          if (isOccupiedForRange(windows, input.checkoutDate, input.dueDate)) {
            throw new AppError(
              ErrorCodes.PRODUCT_UNAVAILABLE,
              409,
              'Product is not available for the requested dates',
            )
          }

          return tx.allocation.create({
            data: {
              productId: input.productId,
              clientId: input.clientId,
              staffId: input.staffId,
              checkoutDate: input.checkoutDate,
              dueDate: input.dueDate,
              status: 'reserved',
              priceCharged: input.priceCharged,
            },
          })
        },
        useSerializable ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } : undefined,
      )
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        continue
      }
      throw error
    }
  }

  throw new AppError(
    ErrorCodes.PRODUCT_UNAVAILABLE,
    409,
    'Could not complete allocation due to repeated write conflicts, please retry',
  )
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

export async function checkOutAllocation(id: string, data: CheckOutInput) {
  const allocation = await getAllocationOrThrow(id)
  if (allocation.status !== 'reserved') {
    throw new AppError(
      ErrorCodes.INVALID_ALLOCATION_TRANSITION,
      409,
      `Cannot check out an allocation with status ${allocation.status}`,
    )
  }
  return prisma.allocation.update({
    where: { id },
    data: {
      status: 'checked_out',
      conditionNotesOut: data.conditionNotesOut,
      depositCollected: data.depositCollected,
    },
  })
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
  return prisma.allocation.update({
    where: { id },
    data: {
      status: 'returned',
      actualReturnDate: data.actualReturnDate ?? new Date(),
      conditionNotesIn: data.conditionNotesIn,
      depositReturned: data.depositReturned,
    },
  })
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
  return prisma.allocation.update({ where: { id }, data: { status: 'cancelled' } })
}

export async function getProductAvailability(productId: string, asOf: Date = new Date()) {
  const allocations = await prisma.allocation.findMany({
    where: { productId, status: { in: ACTIVE_STATUSES } },
  })
  return derivedAvailability(allocations.map(toWindow), asOf)
}
