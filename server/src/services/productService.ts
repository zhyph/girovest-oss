import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../db/client.js'
import { scopedDb } from '../db/scopedClient.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import {
  addUtcDays,
  derivedAvailability,
  maintenanceEndsOn,
  type AllocationWindow,
  type DerivedAvailability,
} from '../domain/occupancy.js'
import {
  blockingAllocationsWhere,
  loadBlockingWindows,
  maintenanceBufferForLocation,
  maintenanceBufferForProduct,
  toWindow,
} from './occupancyQuery.js'

export type ProductStatus = 'active' | 'maintenance' | 'retired'

export interface ProductDTO {
  id: string
  locationId: string
  /** Sequential per-shop reference; null only until the startup backfill runs. */
  code: number | null
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
  code: number | null
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

  // The cleaning window is a per-shop setting. Both callers (listProducts and
  // listProductsForLocation) now scope every call to a single location, but
  // grouping by buffer value rather than by location keeps this correct
  // without relying on that invariant, and keeps the query count following
  // the number of distinct settings (one, in every real deployment) instead
  // of the number of products.
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

/**
 * Deliberately identical to contractService's contract-numbering loop, down
 * to the retried Prisma error codes: read the highest code for the location,
 * add one, and let the `@@unique([locationId, code])` constraint — not the
 * read — be what actually decides the race. Two staff adding a piece at the
 * same second both compute the same next code; the loser gets P2002 (or
 * P2034 under Postgres' Serializable isolation) and retries with a fresh
 * read instead of failing the create.
 */
const MAX_CODE_CONFLICT_RETRIES = 5

export async function createProduct(data: CreateProductInput): Promise<ProductDTO> {
  const useSerializable = process.env.DB_PROVIDER === 'postgresql'

  for (let attempt = 0; attempt < MAX_CODE_CONFLICT_RETRIES; attempt++) {
    try {
      const row = await prisma.$transaction(
        async (tx) => {
          // `code: { not: null }` is not decoration: Postgres sorts NULLs
          // FIRST on a DESC ordering, so without it the highest code read
          // back from a shop that still has un-backfilled pieces would be
          // null, restarting the sequence at 1 and colliding with every
          // existing piece.
          // ast-grep-ignore: no-unscoped-location-model — Already filters by where: { locationId }; the $transaction callback has no scopedDb equivalent.
          const last = await tx.product.findFirst({
            where: { locationId: data.locationId, code: { not: null } },
            orderBy: { code: 'desc' },
            select: { code: true },
          })
          // ast-grep-ignore: no-unscoped-location-model — Non-HTTP caller (photo token flow); locationId is explicit param.
          return tx.product.create({
            data: {
              locationId: data.locationId,
              code: (last?.code ?? 0) + 1,
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
        },
        useSerializable ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } : undefined,
      )
      return toDTO(row, 'available', false)
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
    ErrorCodes.VALIDATION_ERROR,
    409,
    'Could not assign a product code due to repeated write conflicts, please retry',
  )
}

export async function listProducts(locationId: string): Promise<ProductDTO[]> {
  const rows = await scopedDb(locationId).product.findMany({ orderBy: { createdAt: 'desc' } })
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

export async function getProduct(locationId: string, id: string): Promise<ProductDTO> {
  const row = await scopedDb(locationId).product.findUnique({ where: { id } })
  if (!row) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${id} not found`)
  }
  return toDTO(row, await availabilityFor(id), await hasHistory(id))
}

export async function updateProduct(locationId: string, id: string, data: UpdateProductInput): Promise<ProductDTO> {
  await getProduct(locationId, id)
  const row = await scopedDb(locationId).product.update({
    where: { id },
    data: {
      ...data,
      photos: data.photos ? JSON.stringify(data.photos) : undefined,
    } as any,
  })
  return toDTO(row, await availabilityFor(id), await hasHistory(id))
}

export interface LeavingMaintenanceItem {
  id: string
  name: string
  /** First day the piece can go out again: the day after its cleaning window ends. */
  availableOn: string
}

export interface LeavingMaintenanceSummary {
  count: number
  items: LeavingMaintenanceItem[]
}

/** How far ahead the dashboard looks for pieces about to come back into circulation. */
export const LEAVING_MAINTENANCE_WINDOW_DAYS = 2

/**
 * Pieces sitting in the shop's cleaning window today whose window closes
 * within the next `withinDays` days — what the shop can promise a walk-in
 * customer this week without touching anything that is still out.
 *
 * Deliberately reuses the same maintenance-window machinery availability does
 * (`maintenanceBufferForLocation` + `blockingAllocationsWhere` +
 * `maintenanceEndsOn`), so this can never drift from what the Produtos screen
 * calls "Em higienização".
 */
export async function listLeavingMaintenance(
  locationId: string,
  withinDays: number = LEAVING_MAINTENANCE_WINDOW_DAYS,
  asOf: Date = new Date(),
): Promise<LeavingMaintenanceSummary> {
  const maintenanceBufferDays = await maintenanceBufferForLocation(locationId)
  // With no cleaning buffer configured a piece is free the day after it comes
  // back — there is no window to leave, and no allocations worth loading.
  if (maintenanceBufferDays === 0) return { count: 0, items: [] }

  const rows = await scopedDb(locationId).product.findMany({
    where: { status: 'active' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  if (rows.length === 0) return { count: 0, items: [] }

  const allocations = await prisma.allocation.findMany({
    where: blockingAllocationsWhere(
      rows.map((row) => row.id),
      maintenanceBufferDays,
      asOf,
    ),
  })
  const windowsByProduct = new Map<string, AllocationWindow[]>()
  for (const allocation of allocations) {
    windowsByProduct.set(allocation.productId, [
      ...(windowsByProduct.get(allocation.productId) ?? []),
      toWindow(allocation),
    ])
  }

  const cutoff = addUtcDays(asOf, withinDays)
  const items: LeavingMaintenanceItem[] = []
  for (const row of rows) {
    const endsOn = maintenanceEndsOn(windowsByProduct.get(row.id) ?? [], asOf, { maintenanceBufferDays })
    if (!endsOn || endsOn.getTime() > cutoff.getTime()) continue
    items.push({
      id: row.id,
      name: row.name,
      availableOn: addUtcDays(endsOn, 1).toISOString().slice(0, 10),
    })
  }
  items.sort((a, b) => a.availableOn.localeCompare(b.availableOn) || a.name.localeCompare(b.name))

  return { count: items.length, items }
}

export async function deleteProduct(locationId: string, id: string): Promise<void> {
  await getProduct(locationId, id)
  const allocationCount = await prisma.allocation.count({ where: { productId: id } })
  if (allocationCount > 0) {
    throw new AppError(
      ErrorCodes.CANNOT_DELETE_WITH_HISTORY,
      409,
      'Cannot delete a product with allocation history',
    )
  }
  await scopedDb(locationId).product.delete({ where: { id } })
}
