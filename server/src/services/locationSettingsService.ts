import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

export interface ClauseInput {
  text: string
}

export interface UpdateLocationSettingsInput {
  phone?: string | null
  clauses?: ClauseInput[]
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
  clauses: ClauseDTO[]
}

function toDTO(location: {
  id: string
  name: string
  phone: string | null
  contractClauses: ClauseDTO[]
}): LocationSettingsDTO {
  return {
    id: location.id,
    name: location.name,
    phone: location.phone,
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
    if (data.phone !== undefined) {
      await tx.location.update({ where: { id: locationId }, data: { phone: data.phone } })
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
