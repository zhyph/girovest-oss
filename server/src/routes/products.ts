import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/authMiddleware.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import {
  createProduct,
  listProducts,
  getProduct,
  updateProduct,
  deleteProduct,
} from '../services/productService.js'

export const productsRouter = Router()
productsRouter.use(requireAuth)

const createSchema = z.object({
  locationId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().min(1),
  size: z.string().min(1),
  color: z.string().min(1),
  rentalPrice: z.number().nonnegative(),
  depositAmount: z.number().nonnegative(),
  photos: z.array(z.string()).optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  category: z.string().min(1).optional(),
  size: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  rentalPrice: z.number().nonnegative().optional(),
  depositAmount: z.number().nonnegative().optional(),
  photos: z.array(z.string()).optional(),
  status: z.enum(['active', 'maintenance', 'retired']).optional(),
})

productsRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid product payload')
  }
  res.status(201).json(await createProduct(parsed.data))
})

productsRouter.get('/', async (_req, res) => {
  res.json(await listProducts())
})

productsRouter.get('/:id', async (req, res) => {
  res.json(await getProduct(req.params.id))
})

productsRouter.patch('/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid product payload')
  }
  res.json(await updateProduct(req.params.id, parsed.data))
})

productsRouter.delete('/:id', async (req, res) => {
  await deleteProduct(req.params.id)
  res.status(204).send()
})
