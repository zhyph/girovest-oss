import { Router } from 'express'
import { z } from 'zod'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { needsSetup, completeSetup } from '../services/setupService.js'

export const setupRouter = Router()

setupRouter.get('/status', async (_req, res) => {
  res.json({ needsSetup: await needsSetup() })
})

const completeSetupSchema = z.object({
  shopName: z.string().min(1),
  shopAddress: z.string().min(1),
  ownerName: z.string().min(1),
  ownerLogin: z.string().min(1),
  ownerPassword: z.string().min(8),
  // Optional so an older client's wizard payload still validates; the
  // service then falls back to the schema default ('lan').
  connectivityMode: z.enum(['lan', 'relay']).optional(),
})

setupRouter.post('/', async (req, res) => {
  const parsed = completeSetupSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid setup payload')
  }
  const result = await completeSetup(parsed.data)
  res.status(201).json(result)
})
