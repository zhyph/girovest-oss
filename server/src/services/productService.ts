import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { derivedAvailability, type AllocationStatus, type DerivedAvailability } from '../domain/occupancy.js'

const ACTIVE_ALLOCATION_STATUSES: AllocationStatus[] = ['reserved', 'checked_out']

export type ProductStatus = 'active' | 'maintenance' | 'retired'

export interface ProductDTO {
  id: string
  locationId: string
  name: string
  description: string | null
  category: string
  size: string
  color: string
  rentalPrice: number
  depositAmount: number
  photos: string[]
  status: ProductStatus
  availability: DerivedAvailability
  createdAt: Date
}

export interface CreateProductInput {
  locationId: string
  name: string
  description?: string
  category: string
  size: string
  color: string
  rentalPrice: number
  depositAmount: number
  photos?: string[]
}

export interface UpdateProductInput {
  name?: string
  description?: string | null
  category?: string
  size?: string
  color?: string
  rentalPrice?: number
  depositAmount?: number
  photos?: string[]
  status?: ProductStatus
}

interface ProductRow {
  id: string
  locationId: string
  name: string
  description: string | null
  category: string
  size: string
  color: string
  rentalPrice: number
  depositAmount: number
  photos: string
  status: string
  createdAt: Date
}

function toDTO(row: ProductRow, availability: DerivedAvailability): ProductDTO {
  return {
    ...row,
    photos: JSON.parse(row.photos) as string[],
    status: row.status as ProductStatus,
    availability,
  }
}

async function availabilityFor(productId: string, asOf = new Date()): Promise<DerivedAvailability> {
  const allocations = await prisma.allocation.findMany({
    where: { productId, status: { in: ACTIVE_ALLOCATION_STATUSES } },
  })
  return derivedAvailability(
    allocations.map((allocation) => ({
      status: allocation.status as AllocationStatus,
      checkoutDate: allocation.checkoutDate,
      dueDate: allocation.dueDate,
      actualReturnDate: allocation.actualReturnDate,
    })),
    asOf,
  )
}

async function availabilityByProductId(productIds: string[]): Promise<Map<string, DerivedAvailability>> {
  const result = new Map<string, DerivedAvailability>()
  if (productIds.length === 0) return result

  const allocations = await prisma.allocation.findMany({
    where: { productId: { in: productIds }, status: { in: ACTIVE_ALLOCATION_STATUSES } },
  })
  const byProduct = new Map<string, typeof allocations>()
  for (const allocation of allocations) {
    const list = byProduct.get(allocation.productId) ?? []
    list.push(allocation)
    byProduct.set(allocation.productId, list)
  }

  const asOf = new Date()
  for (const productId of productIds) {
    const windows = (byProduct.get(productId) ?? []).map((allocation) => ({
      status: allocation.status as AllocationStatus,
      checkoutDate: allocation.checkoutDate,
      dueDate: allocation.dueDate,
      actualReturnDate: allocation.actualReturnDate,
    }))
    result.set(productId, derivedAvailability(windows, asOf))
  }
  return result
}

export async function createProduct(data: CreateProductInput): Promise<ProductDTO> {
  const row = await prisma.product.create({
    data: {
      locationId: data.locationId,
      name: data.name,
      description: data.description,
      category: data.category,
      size: data.size,
      color: data.color,
      rentalPrice: data.rentalPrice,
      depositAmount: data.depositAmount,
      photos: JSON.stringify(data.photos ?? []),
    },
  })
  return toDTO(row, 'available')
}

export async function listProducts(): Promise<ProductDTO[]> {
  const rows = await prisma.product.findMany({ orderBy: { createdAt: 'desc' } })
  const availability = await availabilityByProductId(rows.map((row) => row.id))
  return rows.map((row) => toDTO(row, availability.get(row.id) ?? 'available'))
}

export async function getProduct(id: string): Promise<ProductDTO> {
  const row = await prisma.product.findUnique({ where: { id } })
  if (!row) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${id} not found`)
  }
  return toDTO(row, await availabilityFor(id))
}

export async function updateProduct(id: string, data: UpdateProductInput): Promise<ProductDTO> {
  await getProduct(id)
  const row = await prisma.product.update({
    where: { id },
    data: {
      ...data,
      photos: data.photos ? JSON.stringify(data.photos) : undefined,
    },
  })
  return toDTO(row, await availabilityFor(id))
}

export async function deleteProduct(id: string): Promise<void> {
  await getProduct(id)
  const allocationCount = await prisma.allocation.count({ where: { productId: id } })
  if (allocationCount > 0) {
    throw new AppError(
      ErrorCodes.CANNOT_DELETE_WITH_HISTORY,
      409,
      'Cannot delete a product with allocation history',
    )
  }
  await prisma.product.delete({ where: { id } })
}
