import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

export interface ClauseInput {
  text: string
}

export interface UpdateLocationSettingsInput {
  /** The shop's own name — prints as the contract header and titles the app. */
  name?: string
  /** The shop's street address, printed under the name on the contract. */
  address?: string
  phone?: string | null
  clauses?: ClauseInput[]
  maintenanceBufferDays?: number
  connectivityMode?: 'lan' | 'relay'
}

export interface ClauseDTO {
  id: string
  text: string
  sortOrder: number
}

export interface LocationSettingsDTO {
  id: string
  name: string
  address: string
  phone: string | null
  maintenanceBufferDays: number
  connectivityMode: 'lan' | 'relay'
  clauses: ClauseDTO[]
}

function toDTO(location: {
  id: string
  name: string
  address: string
  phone: string | null
  maintenanceBufferDays: number
  connectivityMode: string
  contractClauses: ClauseDTO[]
}): LocationSettingsDTO {
  return {
    id: location.id,
    name: location.name,
    address: location.address,
    phone: location.phone,
    maintenanceBufferDays: location.maintenanceBufferDays,
    connectivityMode: location.connectivityMode === 'relay' ? 'relay' : 'lan',
    clauses: [...location.contractClauses].sort((a, b) => a.sortOrder - b.sortOrder),
  }
}

export async function getLocationSettings(locationId: string): Promise<LocationSettingsDTO> {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    include: { contractClauses: true },
  })
  if (!location) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Location ${locationId} not found`)
  }
  return toDTO(location)
}

export async function updateLocationSettings(
  locationId: string,
  data: UpdateLocationSettingsInput,
): Promise<LocationSettingsDTO> {
  await getLocationSettings(locationId)

  await prisma.$transaction(async (tx) => {
    if (
      data.name !== undefined ||
      data.address !== undefined ||
      data.phone !== undefined ||
      data.maintenanceBufferDays !== undefined ||
      data.connectivityMode !== undefined
    ) {
      await tx.location.update({
        where: { id: locationId },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.address !== undefined ? { address: data.address } : {}),
          ...(data.phone !== undefined ? { phone: data.phone } : {}),
          ...(data.maintenanceBufferDays !== undefined
            ? { maintenanceBufferDays: data.maintenanceBufferDays }
            : {}),
          ...(data.connectivityMode !== undefined ? { connectivityMode: data.connectivityMode } : {}),
        },
      })
    }

    if (data.clauses !== undefined) {
      await tx.locationContractClause.deleteMany({ where: { locationId } })
      if (data.clauses.length > 0) {
        await tx.locationContractClause.createMany({
          data: data.clauses.map((clause, index) => ({ locationId, text: clause.text, sortOrder: index })),
        })
      }
    }
  })

  return getLocationSettings(locationId)
}
