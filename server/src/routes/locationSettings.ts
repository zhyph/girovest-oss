import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/authMiddleware.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { prisma } from '../db/client.js'
import { getLocationSettings, updateLocationSettings } from '../services/locationSettingsService.js'

export const locationSettingsRouter = Router()
locationSettingsRouter.use(requireAuth)

async function resolveLocationId(staffId: string): Promise<string> {
  const staff = await prisma.staff.findUniqueOrThrow({ where: { id: staffId } })
  return staff.locationId
}

locationSettingsRouter.get('/', async (req, res) => {
  const locationId = await resolveLocationId(req.staff!.staffId)
  res.json(await getLocationSettings(locationId))
})

const clauseSchema = z.object({ text: z.string().min(1) })

const updateSchema = z.object({
  phone: z.string().nullable().optional(),
  clauses: z.array(clauseSchema).optional(),
})

locationSettingsRouter.patch('/', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success || !req.staff) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid settings payload')
  }
  const locationId = await resolveLocationId(req.staff.staffId)
  res.json(await updateLocationSettings(locationId, parsed.data))
})
