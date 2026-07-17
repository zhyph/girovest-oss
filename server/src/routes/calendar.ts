import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/authMiddleware.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { listGoingOut, listDueBack, listOverdue } from '../services/calendarService.js'

export const calendarRouter = Router()
calendarRouter.use(requireAuth)

const rangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
})

calendarRouter.get('/going-out', async (req, res) => {
  const parsed = rangeSchema.safeParse(req.query)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'from and to query params are required')
  }
  res.json(await listGoingOut(parsed.data.from, parsed.data.to))
})

calendarRouter.get('/due-back', async (req, res) => {
  const parsed = rangeSchema.safeParse(req.query)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'from and to query params are required')
  }
  res.json(await listDueBack(parsed.data.from, parsed.data.to))
})

calendarRouter.get('/overdue', async (req, res) => {
  const asOf = req.query.asOf ? new Date(String(req.query.asOf)) : new Date()
  res.json(await listOverdue(asOf))
})
