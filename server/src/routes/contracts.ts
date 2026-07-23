import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/authMiddleware.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { createContract, cancelContract, listContracts } from '../services/contractService.js'

export const contractsRouter = Router()
contractsRouter.use(requireAuth)

contractsRouter.get('/', async (_req, res) => {
  res.json(await listContracts())
})

const itemSchema = z.object({
  productId: z.string().min(1),
  checkoutDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  priceCharged: z.number().nonnegative(),
})

const installmentSchema = z.object({
  dueDate: z.coerce.date(),
  amount: z.number().nonnegative(),
})

const createSchema = z.object({
  locationId: z.string().min(1),
  clientId: z.string().min(1),
  eventDate: z.coerce.date(),
  paymentMethod: z.string().min(1),
  items: z.array(itemSchema).min(1),
  installments: z.array(installmentSchema),
})

contractsRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success || !req.staff) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid contract payload')
  }
  const contract = await createContract({ ...parsed.data, staffId: req.staff.staffId })
  res.status(201).json(contract)
})

contractsRouter.post('/:id/cancel', async (req, res) => {
  res.json(await cancelContract(req.params.id))
})
