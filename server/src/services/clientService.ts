import { scopedDb } from '../db/scopedClient.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { prisma } from '../db/client.js'

export interface IdentityDocumentInput {
  label: string
  value: string
  maskKey?: string | null
}

export interface AddressLineInput {
  label: string
  value: string
  sortOrder: number
  maskKey?: string | null
}

export interface CreateClientInput {
  name: string
  phone: string
  email: string
  notes?: string
  identityDocuments?: IdentityDocumentInput[]
  addressLines?: AddressLineInput[]
}

export interface UpdateClientInput {
  name?: string
  phone?: string
  email?: string
  notes?: string | null
  identityDocuments?: IdentityDocumentInput[]
  addressLines?: AddressLineInput[]
}

export interface IdentityDocumentDTO {
  id: string
  label: string
  value: string
  maskKey: string | null
}

export interface AddressLineDTO {
  id: string
  label: string
  value: string
  sortOrder: number
  maskKey: string | null
}

export interface ClientDTO {
  id: string
  locationId: string
  name: string
  phone: string
  email: string
  notes: string | null
  hasAllocationHistory: boolean
  createdAt: Date
  identityDocuments: IdentityDocumentDTO[]
  addressLines: AddressLineDTO[]
  /** Total contracts this client has, cancelled or not — matches how the
   *  detail panel's "N contratos" has always counted. */
  contractCount: number
  /** The piece from the client's most recent NON-cancelled allocation, or
   *  null if she has never rented anything (or every rental was cancelled). */
  lastRentalProductId: string | null
  lastRentalDate: string | null
}

interface ClientRow {
  id: string
  locationId: string
  name: string
  phone: string
  email: string
  notes: string | null
  createdAt: Date
  identityDocuments: IdentityDocumentDTO[]
  addressLines: AddressLineDTO[]
}

const CLIENT_INCLUDE = {
  identityDocuments: true,
  addressLines: { orderBy: { sortOrder: 'asc' as const } },
}

interface RentalSummary {
  contractCount: number
  lastRentalProductId: string | null
  lastRentalDate: string | null
}

const EMPTY_RENTAL_SUMMARY: RentalSummary = {
  contractCount: 0,
  lastRentalProductId: null,
  lastRentalDate: null,
}

function toDTO(row: ClientRow, hasAllocationHistory: boolean, rental: RentalSummary): ClientDTO {
  return { ...row, hasAllocationHistory, ...rental }
}

async function hasHistory(clientId: string): Promise<boolean> {
  // Allocation has no locationId column — it's reached via product/client
  // relations, so this stays on the bare prisma client (Allocation isn't in
  // scopedDb's registry; see scopedClient.ts).
  const count = await prisma.allocation.count({ where: { clientId } })
  return count > 0
}

async function historyByClientId(clientIds: string[]): Promise<Set<string>> {
  const result = new Set<string>()
  if (clientIds.length === 0) return result
  const allocations = await prisma.allocation.findMany({
    where: { clientId: { in: clientIds } },
    select: { clientId: true },
    distinct: ['clientId'],
  })
  for (const allocation of allocations) {
    result.add(allocation.clientId)
  }
  return result
}

/**
 * Contract count + most recent rental per client, computed here instead of
 * being derived in the browser from every contract at this location — the
 * Clientes list used to fetch the location's entire contract history just
 * to answer two small per-row facts, which stopped being "fine" the moment
 * a shop's contract count grew past what fits comfortably in one response.
 *
 * `locationId` is redundant with `clientIds` already being scoped (every
 * caller derives them from a `scopedDb(locationId).client.findMany()` a few
 * lines above), but Contract carries the column and contractService.ts
 * already filters by it explicitly everywhere else — same belt-and-suspenders
 * reasoning, no reason to be the one place that doesn't.
 */
async function rentalSummaryByClientId(
  locationId: string,
  clientIds: string[],
): Promise<Map<string, RentalSummary>> {
  const result = new Map<string, RentalSummary>()
  if (clientIds.length === 0) return result

  const [contractCounts, lastRentals] = await Promise.all([
    prisma.contract.groupBy({
      by: ['clientId'],
      where: { locationId, clientId: { in: clientIds } },
      _count: { _all: true },
    }),
    // distinct + orderBy keeps exactly one row per clientId — the one with
    // the latest checkoutDate, since sorting puts it first within each
    // client's group before the distinct dedup runs. A cancelled allocation
    // never left the shop, so it cannot be the last thing she wore.
    prisma.allocation.findMany({
      where: { clientId: { in: clientIds }, status: { not: 'cancelled' } },
      select: { clientId: true, productId: true, checkoutDate: true },
      distinct: ['clientId'],
      orderBy: [{ clientId: 'asc' }, { checkoutDate: 'desc' }],
    }),
  ])

  for (const row of contractCounts) {
    result.set(row.clientId, { ...EMPTY_RENTAL_SUMMARY, contractCount: row._count._all })
  }
  for (const row of lastRentals) {
    const existing = result.get(row.clientId) ?? { ...EMPTY_RENTAL_SUMMARY }
    result.set(row.clientId, {
      ...existing,
      lastRentalProductId: row.productId,
      lastRentalDate: row.checkoutDate.toISOString(),
    })
  }
  return result
}

export async function createClient(locationId: string, data: CreateClientInput): Promise<ClientDTO> {
  const row = await scopedDb(locationId).client.create({
    data: {
      name: data.name,
      phone: data.phone,
      email: data.email,
      notes: data.notes,
      identityDocuments: data.identityDocuments ? { create: data.identityDocuments } : undefined,
      addressLines: data.addressLines ? { create: data.addressLines } : undefined,
    } as any,
    include: CLIENT_INCLUDE,
  })
  // A brand-new client has no contracts yet — skip the query entirely rather
  // than asking rentalSummaryByClientId to prove what's already known.
  return toDTO(row, false, { ...EMPTY_RENTAL_SUMMARY })
}

export async function listClients(locationId: string): Promise<ClientDTO[]> {
  const rows = await scopedDb(locationId).client.findMany({
    orderBy: { createdAt: 'desc' },
    include: CLIENT_INCLUDE,
  })
  const clientIds = rows.map((row) => row.id)
  const [withHistory, rentalSummaries] = await Promise.all([
    historyByClientId(clientIds),
    rentalSummaryByClientId(locationId, clientIds),
  ])
  return rows.map((row) =>
    toDTO(row, withHistory.has(row.id), rentalSummaries.get(row.id) ?? { ...EMPTY_RENTAL_SUMMARY }),
  )
}

export async function getClient(locationId: string, id: string): Promise<ClientDTO> {
  const row = await scopedDb(locationId).client.findUnique({ where: { id }, include: CLIENT_INCLUDE })
  if (!row) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Client ${id} not found`)
  }
  const [historyFlag, rentalSummaries] = await Promise.all([
    hasHistory(id),
    rentalSummaryByClientId(locationId, [id]),
  ])
  return toDTO(row, historyFlag, rentalSummaries.get(id) ?? { ...EMPTY_RENTAL_SUMMARY })
}

export async function updateClient(locationId: string, id: string, data: UpdateClientInput): Promise<ClientDTO> {
  await getClient(locationId, id)

  await prisma.$transaction(async (tx) => {
    // This is the bare prisma $transaction, not scopedDb(locationId).$transaction,
    // so tx.client.update's `where: { id }` below is NOT itself scoped to
    // locationId. That's safe only because getClient(locationId, id) above
    // already throws 404 if `id` doesn't belong to locationId — by the time
    // we get here, id is proven to belong to this location, so every by-id
    // operation inside this transaction (client, clientIdentityDocument,
    // clientAddressLine) is safe without needing scopedDb's own scoping.
    // Do not remove the getClient guard above as "redundant" — it is the
    // only thing making this transaction location-safe.
    // ast-grep-ignore: no-unscoped-location-model — Safe only because getClient(locationId, id) above already 404s on a cross-location id; id is proven to belong to this location by the time we get here.
    await tx.client.update({
      where: { id },
      data: { name: data.name, phone: data.phone, email: data.email, notes: data.notes },
    })

    if (data.identityDocuments !== undefined) {
      await tx.clientIdentityDocument.deleteMany({ where: { clientId: id } })
      if (data.identityDocuments.length > 0) {
        await tx.clientIdentityDocument.createMany({
          data: data.identityDocuments.map((doc) => ({ ...doc, clientId: id })),
        })
      }
    }

    if (data.addressLines !== undefined) {
      await tx.clientAddressLine.deleteMany({ where: { clientId: id } })
      if (data.addressLines.length > 0) {
        await tx.clientAddressLine.createMany({
          data: data.addressLines.map((line) => ({ ...line, clientId: id })),
        })
      }
    }
  })

  return getClient(locationId, id)
}

export async function deleteClient(locationId: string, id: string): Promise<void> {
  await getClient(locationId, id)
  if (await hasHistory(id)) {
    throw new AppError(
      ErrorCodes.CANNOT_DELETE_WITH_HISTORY,
      409,
      'Cannot delete a client with allocation history',
    )
  }
  await scopedDb(locationId).client.delete({ where: { id } })
}
