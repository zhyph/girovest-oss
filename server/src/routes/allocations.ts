import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/authMiddleware.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { isoDate } from '../lib/zodDate.js'
import {
  checkOutAllocation,
  returnAllocation,
  cancelAllocation,
  repriceAllocation,
  getProductAvailability,
  isProductAvailableForRange,
  listAllocations,
} from '../services/allocationService.js'

export const allocationsRouter = Router()
allocationsRouter.use(requireAuth)

allocationsRouter.get('/', async (req, res) => {
  res.json(await listAllocations(req.staff!.locationId))
})

const checkOutSchema = z.object({
  conditionNotesOut: z.string().optional(),
  depositCollected: z.number().nonnegative().optional(),
  // Set only after the operator confirmed the early pickup in the UI.
  allowEarly: z.boolean().optional(),
})

const returnSchema = z.object({
  conditionNotesIn: z.string().optional(),
  depositReturned: z.number().nonnegative().optional(),
  actualReturnDate: isoDate.optional(),
})

allocationsRouter.post('/:id/check-out', async (req, res) => {
  const parsed = checkOutSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid check-out payload')
  }
  res.json(await checkOutAllocation(req.staff!.locationId, req.params.id, parsed.data))
})

allocationsRouter.post('/:id/return', async (req, res) => {
  const parsed = returnSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid return payload')
  }
  res.json(await returnAllocation(req.staff!.locationId, req.params.id, parsed.data))
})

// nonnegative, matching what creation accepts (routes/contracts.ts) — a
// courtesy piece booked at R$ 0 must be correctable back to R$ 0.
const repriceSchema = z.object({ priceCharged: z.number().nonnegative() })

allocationsRouter.patch('/:id/price', async (req, res) => {
  const parsed = repriceSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid price payload')
  }
  res.json(await repriceAllocation(req.staff!.locationId, req.params.id, parsed.data.priceCharged))
})

allocationsRouter.post('/:id/cancel', async (req, res) => {
  res.json(await cancelAllocation(req.staff!.locationId, req.params.id))
})

const availabilityRangeSchema = z.object({
  checkoutDate: isoDate,
  dueDate: isoDate,
})

allocationsRouter.get('/products/:productId/availability', async (req, res) => {
  const rangeParsed = availabilityRangeSchema.safeParse(req.query)
  if (rangeParsed.success) {
    const available = await isProductAvailableForRange(
      req.staff!.locationId,
      req.params.productId,
      rangeParsed.data.checkoutDate,
      rangeParsed.data.dueDate,
    )
    res.json({ available })
    return
  }

  const asOfQuery = req.query.asOf
  const asOf = typeof asOfQuery === 'string' ? new Date(asOfQuery) : new Date()
  res.json({ status: await getProductAvailability(req.staff!.locationId, req.params.productId, asOf) })
})
