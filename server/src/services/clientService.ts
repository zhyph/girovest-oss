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

function toDTO(row: ClientRow, hasAllocationHistory: boolean): ClientDTO {
  return { ...row, hasAllocationHistory }
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
  return toDTO(row, false)
}

export async function listClients(locationId: string): Promise<ClientDTO[]> {
  const rows = await scopedDb(locationId).client.findMany({
    orderBy: { createdAt: 'desc' },
    include: CLIENT_INCLUDE,
  })
  const withHistory = await historyByClientId(rows.map((row) => row.id))
  return rows.map((row) => toDTO(row, withHistory.has(row.id)))
}

export async function getClient(locationId: string, id: string): Promise<ClientDTO> {
  const row = await scopedDb(locationId).client.findUnique({ where: { id }, include: CLIENT_INCLUDE })
  if (!row) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Client ${id} not found`)
  }
  return toDTO(row, await hasHistory(id))
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
