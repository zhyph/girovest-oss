import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { derivedAvailability, type AllocationWindow, type DerivedAvailability } from '../domain/occupancy.js'
import {
  blockingAllocationsWhere,
  loadBlockingWindows,
  maintenanceBufferForProduct,
  toWindow,
} from './occupancyQuery.js'

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
  hasAllocationHistory: boolean
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

function toDTO(row: ProductRow, availability: DerivedAvailability, hasAllocationHistory: boolean): ProductDTO {
  return {
    ...row,
    photos: JSON.parse(row.photos) as string[],
    status: row.status as ProductStatus,
    availability,
    hasAllocationHistory,
  }
}

async function availabilityFor(productId: string, asOf = new Date()): Promise<DerivedAvailability> {
  const maintenanceBufferDays = await maintenanceBufferForProduct(productId)
  const windows = await loadBlockingWindows([productId], maintenanceBufferDays, asOf)
  return derivedAvailability(windows, asOf, { maintenanceBufferDays })
}

async function availabilityByProductId(productIds: string[]): Promise<Map<string, DerivedAvailability>> {
  const result = new Map<string, DerivedAvailability>()
  if (productIds.length === 0) return result

  const asOf = new Date()
  // ast-grep-ignore: no-unscoped-location-model — Batch lookup; caller verifies each productId's location.
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, location: { select: { maintenanceBufferDays: true } } },
  })

  // The cleaning window is a per-shop setting and a listing is NOT guaranteed
  // to be single-shop — GET /api/products lists every location. Collapsing the
  // batch to one buffer would apply the longest window in the page to shops
  // that never configured one, parking their pieces in "maintenance" for days.
  // Grouped by buffer value rather than by location so the query count follows
  // the number of distinct settings (one, in every real deployment) instead of
  // the number of shops.
  const idsByBuffer = new Map<number, string[]>()
  for (const product of products) {
    const buffer = product.location.maintenanceBufferDays
    idsByBuffer.set(buffer, [...(idsByBuffer.get(buffer) ?? []), product.id])
  }

  await Promise.all(
    [...idsByBuffer].map(async ([maintenanceBufferDays, ids]) => {
      const allocations = await prisma.allocation.findMany({
        where: blockingAllocationsWhere(ids, maintenanceBufferDays, asOf),
      })
      const byProduct = new Map<string, AllocationWindow[]>()
      for (const allocation of allocations) {
        byProduct.set(allocation.productId, [...(byProduct.get(allocation.productId) ?? []), toWindow(allocation)])
      }
      for (const id of ids) {
        result.set(id, derivedAvailability(byProduct.get(id) ?? [], asOf, { maintenanceBufferDays }))
      }
    }),
  )

  return result
}

async function hasHistory(productId: string): Promise<boolean> {
  const count = await prisma.allocation.count({ where: { productId } })
  return count > 0
}

async function historyByProductId(productIds: string[]): Promise<Set<string>> {
  const result = new Set<string>()
  if (productIds.length === 0) return result
  const allocations = await prisma.allocation.findMany({
    where: { productId: { in: productIds } },
    select: { productId: true },
    distinct: ['productId'],
  })
  for (const allocation of allocations) {
    result.add(allocation.productId)
  }
  return result
}

export async function createProduct(data: CreateProductInput): Promise<ProductDTO> {
  // ast-grep-ignore: no-unscoped-location-model — Non-HTTP caller (photo token flow); locationId is explicit param.
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
  return toDTO(row, 'available', false)
}

export async function listProducts(): Promise<ProductDTO[]> {
  const rows = await prisma.product.findMany({ orderBy: { createdAt: 'desc' } })
  const availability = await availabilityByProductId(rows.map((row) => row.id))
  const withHistory = await historyByProductId(rows.map((row) => row.id))
  return rows.map((row) =>
    toDTO(row, availability.get(row.id) ?? 'available', withHistory.has(row.id)),
  )
}

export async function listProductsForLocation(
  locationId: string,
  opts: { search?: string; limit?: number },
): Promise<ProductDTO[]> {
  // Prisma's `contains` is case-sensitive on Postgres but case-insensitive on
  // SQLite (by accident of SQLite's default LIKE collation). `mode: 'insensitive'`
  // makes Postgres match SQLite's behavior, but SQLite doesn't support `mode` at
  // all, so it's only added when actually running against Postgres.
  const insensitiveMode = process.env.DB_PROVIDER === 'postgresql' ? ({ mode: 'insensitive' } as const) : {}

  // ast-grep-ignore: no-unscoped-location-model — Already filters by where: { locationId }; correct before and after location-scoping.
  const rows = await prisma.product.findMany({
    where: {
      locationId,
      ...(opts.search
        ? {
            OR: [
              { name: { contains: opts.search, ...insensitiveMode } },
              { category: { contains: opts.search, ...insensitiveMode } },
              { color: { contains: opts.search, ...insensitiveMode } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 20,
  })
  const availability = await availabilityByProductId(rows.map((row) => row.id))
  const withHistory = await historyByProductId(rows.map((row) => row.id))
  return rows.map((row) =>
    toDTO(row, availability.get(row.id) ?? 'available', withHistory.has(row.id)),
  )
}

export async function getProduct(id: string): Promise<ProductDTO> {
  const row = await prisma.product.findUnique({ where: { id } })
  if (!row) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${id} not found`)
  }
  return toDTO(row, await availabilityFor(id), await hasHistory(id))
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
  return toDTO(row, await availabilityFor(id), await hasHistory(id))
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
