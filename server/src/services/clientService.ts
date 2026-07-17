import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

export interface CreateClientInput {
  name: string
  phone: string
  email: string
  notes?: string
}

export interface UpdateClientInput {
  name?: string
  phone?: string
  email?: string
  notes?: string | null
}

export function createClient(data: CreateClientInput) {
  return prisma.client.create({ data })
}

export function listClients() {
  return prisma.client.findMany({ orderBy: { createdAt: 'desc' } })
}

export async function getClient(id: string) {
  const client = await prisma.client.findUnique({ where: { id } })
  if (!client) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Client ${id} not found`)
  }
  return client
}

export async function updateClient(id: string, data: UpdateClientInput) {
  await getClient(id)
  return prisma.client.update({ where: { id }, data })
}

export async function deleteClient(id: string): Promise<void> {
  await getClient(id)
  const allocationCount = await prisma.allocation.count({ where: { clientId: id } })
  if (allocationCount > 0) {
    throw new AppError(
      ErrorCodes.CANNOT_DELETE_WITH_HISTORY,
      409,
      'Cannot delete a client with allocation history',
    )
  }
  await prisma.client.delete({ where: { id } })
}
