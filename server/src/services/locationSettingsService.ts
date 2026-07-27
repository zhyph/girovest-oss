import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

export interface ClauseInput {
  text: string
}

export interface UpdateLocationSettingsInput {
  phone?: string | null
  clauses?: ClauseInput[]
  maintenanceBufferDays?: number
}

export interface ClauseDTO {
  id: string
  text: string
  sortOrder: number
}

export interface LocationSettingsDTO {
  id: string
  name: string
  phone: string | null
  maintenanceBufferDays: number
  clauses: ClauseDTO[]
}

function toDTO(location: {
  id: string
  name: string
  phone: string | null
  maintenanceBufferDays: number
  contractClauses: ClauseDTO[]
}): LocationSettingsDTO {
  return {
    id: location.id,
    name: location.name,
    phone: location.phone,
    maintenanceBufferDays: location.maintenanceBufferDays,
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
    if (data.phone !== undefined || data.maintenanceBufferDays !== undefined) {
      await tx.location.update({
        where: { id: locationId },
        data: {
          ...(data.phone !== undefined ? { phone: data.phone } : {}),
          ...(data.maintenanceBufferDays !== undefined
            ? { maintenanceBufferDays: data.maintenanceBufferDays }
            : {}),
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
