import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { isOccupiedForRange, type AllocationWindow, type AllocationStatus } from '../domain/occupancy.js'

const MAX_WRITE_CONFLICT_RETRIES = 5
const ACTIVE_STATUSES: AllocationStatus[] = ['reserved', 'checked_out']

export interface CreateContractItemInput {
  productId: string
  checkoutDate: Date
  dueDate: Date
  priceCharged: number
}

export interface CreateContractInstallmentInput {
  dueDate: Date
  amount: number
}

export interface CreateContractInput {
  locationId: string
  clientId: string
  staffId: string
  eventDate: Date
  paymentMethod: string
  items: CreateContractItemInput[]
  installments: CreateContractInstallmentInput[]
}

function toWindow(allocation: { status: string; checkoutDate: Date; dueDate: Date; actualReturnDate: Date | null }): AllocationWindow {
  return {
    status: allocation.status as AllocationStatus,
    checkoutDate: allocation.checkoutDate,
    dueDate: allocation.dueDate,
    actualReturnDate: allocation.actualReturnDate,
  }
}

export async function createContract(input: CreateContractInput) {
  if (input.items.length === 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'A contract needs at least one item')
  }
  for (const item of input.items) {
    if (item.dueDate.getTime() < item.checkoutDate.getTime()) {
      throw new AppError(ErrorCodes.DUE_DATE_BEFORE_CHECKOUT, 400, 'Due date must be on or after checkout date')
    }
  }

  const products = await prisma.product.findMany({ where: { id: { in: input.items.map((item) => item.productId) } } })
  const productsById = new Map(products.map((product) => [product.id, product]))
  for (const item of input.items) {
    const product = productsById.get(item.productId)
    if (!product) {
      throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${item.productId} not found`)
    }
    if (product.status !== 'active') {
      throw new AppError(
        ErrorCodes.PRODUCT_NOT_IN_CIRCULATION,
        409,
        `Product is ${product.status} and cannot be allocated`,
      )
    }
  }

  const useSerializable = process.env.DB_PROVIDER === 'postgresql'

  for (let attempt = 0; attempt < MAX_WRITE_CONFLICT_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          for (const item of input.items) {
            const existing = await tx.allocation.findMany({
              where: { productId: item.productId, status: { in: ACTIVE_STATUSES } },
            })
            if (isOccupiedForRange(existing.map(toWindow), item.checkoutDate, item.dueDate)) {
              throw new AppError(
                ErrorCodes.PRODUCT_UNAVAILABLE,
                409,
                `Product ${item.productId} is not available for the requested dates`,
              )
            }
          }

          const lastContract = await tx.contract.findFirst({
            where: { locationId: input.locationId },
            orderBy: { number: 'desc' },
          })
          const nextNumber = (lastContract?.number ?? 0) + 1

          return tx.contract.create({
            data: {
              number: nextNumber,
              locationId: input.locationId,
              clientId: input.clientId,
              staffId: input.staffId,
              eventDate: input.eventDate,
              paymentMethod: input.paymentMethod,
              allocations: {
                create: input.items.map((item) => ({
                  productId: item.productId,
                  clientId: input.clientId,
                  staffId: input.staffId,
                  checkoutDate: item.checkoutDate,
                  dueDate: item.dueDate,
                  status: 'reserved',
                  priceCharged: item.priceCharged,
                })),
              },
              installments: {
                create: input.installments.map((installment) => ({
                  dueDate: installment.dueDate,
                  amount: installment.amount,
                })),
              },
            },
            include: { allocations: true, installments: true },
          })
        },
        useSerializable ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } : undefined,
      )
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || error.code === 'P2002')
      ) {
        continue
      }
      throw error
    }
  }

  throw new AppError(
    ErrorCodes.PRODUCT_UNAVAILABLE,
    409,
    'Could not complete contract creation due to repeated write conflicts, please retry',
  )
}
