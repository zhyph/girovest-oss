import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/authMiddleware.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { getLocationSettings, updateLocationSettings } from '../services/locationSettingsService.js'

export const locationSettingsRouter = Router()
locationSettingsRouter.use(requireAuth)

locationSettingsRouter.get('/', async (req, res) => {
  const locationId = req.staff!.locationId
  res.json(await getLocationSettings(locationId))
})

const clauseSchema = z.object({ text: z.string().min(1) })

const updateSchema = z.object({
  // Both print on the contract header and name the app itself, so neither may
  // be blanked out — an empty shop name would leave the nav rail and every
  // printed contract with a blank where the shop's identity goes.
  name: z.string().trim().min(1).max(200).optional(),
  address: z.string().trim().min(1).max(300).optional(),
  phone: z.string().nullable().optional(),
  clauses: z.array(clauseSchema).optional(),
  // Capped because this silently blocks days on every piece in the shop —
  // a mistyped 300 would take the whole catalogue off the market for a year.
  maintenanceBufferDays: z.number().int().min(0).max(60).optional(),
  connectivityMode: z.enum(['lan', 'relay']).optional(),
})

locationSettingsRouter.patch('/', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success || !req.staff) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid settings payload')
  }
  const locationId = req.staff.locationId
  res.json(await updateLocationSettings(locationId, parsed.data))
})
