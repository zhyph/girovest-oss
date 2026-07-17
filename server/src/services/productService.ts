import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

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

function toDTO(row: ProductRow): ProductDTO {
  return {
    ...row,
    photos: JSON.parse(row.photos) as string[],
    status: row.status as ProductStatus,
  }
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
  return toDTO(row)
}

export async function listProducts(): Promise<ProductDTO[]> {
  const rows = await prisma.product.findMany({ orderBy: { createdAt: 'desc' } })
  return rows.map(toDTO)
}

export async function getProduct(id: string): Promise<ProductDTO> {
  const row = await prisma.product.findUnique({ where: { id } })
  if (!row) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${id} not found`)
  }
  return toDTO(row)
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
  return toDTO(row)
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
