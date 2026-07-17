import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/authMiddleware.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import {
  createAllocation,
  checkOutAllocation,
  returnAllocation,
  cancelAllocation,
  getProductAvailability,
} from '../services/allocationService.js'

export const allocationsRouter = Router()
allocationsRouter.use(requireAuth)

const createSchema = z.object({
  productId: z.string().min(1),
  clientId: z.string().min(1),
  checkoutDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  priceCharged: z.number().nonnegative(),
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

allocationsRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success || !req.staff) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid allocation payload')
  }
  const allocation = await createAllocation({ ...parsed.data, staffId: req.staff.staffId })
  res.status(201).json(allocation)
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

allocationsRouter.get('/products/:productId/availability', async (req, res) => {
  const asOf = req.query.asOf ? new Date(String(req.query.asOf)) : new Date()
  res.json({ status: await getProductAvailability(req.params.productId, asOf) })
})
