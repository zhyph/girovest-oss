import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/authMiddleware.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import {
  checkOutAllocation,
  returnAllocation,
  cancelAllocation,
  getProductAvailability,
  isProductAvailableForRange,
  listAllocations,
} from '../services/allocationService.js'

export const allocationsRouter = Router()
allocationsRouter.use(requireAuth)

allocationsRouter.get('/', async (_req, res) => {
  res.json(await listAllocations())
})

const checkOutSchema = z.object({
  conditionNotesOut: z.string().optional(),
  depositCollected: z.number().nonnegative().optional(),
})

const returnSchema = z.object({
  conditionNotesIn: z.string().optional(),
  depositReturned: z.number().nonnegative().optional(),
  actualReturnDate: z.coerce.date().optional(),
})

allocationsRouter.post('/:id/check-out', async (req, res) => {
  const parsed = checkOutSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid check-out payload')
  }
  res.json(await checkOutAllocation(req.params.id, parsed.data))
})

allocationsRouter.post('/:id/return', async (req, res) => {
  const parsed = returnSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid return payload')
  }
  res.json(await returnAllocation(req.params.id, parsed.data))
})

allocationsRouter.post('/:id/cancel', async (req, res) => {
  res.json(await cancelAllocation(req.params.id))
})

const availabilityRangeSchema = z.object({
  checkoutDate: z.coerce.date(),
  dueDate: z.coerce.date(),
})

allocationsRouter.get('/products/:productId/availability', async (req, res) => {
  const rangeParsed = availabilityRangeSchema.safeParse(req.query)
  if (rangeParsed.success) {
    const available = await isProductAvailableForRange(
      req.params.productId,
      rangeParsed.data.checkoutDate,
      rangeParsed.data.dueDate,
    )
    res.json({ available })
    return
  }

  const asOfQuery = req.query.asOf
  const asOf = typeof asOfQuery === 'string' ? new Date(asOfQuery) : new Date()
  res.json({ status: await getProductAvailability(req.params.productId, asOf) })
})
