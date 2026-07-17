import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/authMiddleware.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { createClient, listClients, getClient, updateClient, deleteClient } from '../services/clientService.js'

export const clientsRouter = Router()
clientsRouter.use(requireAuth)

const createSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email(),
  notes: z.string().optional(),
})

const updateSchema = createSchema.partial()

clientsRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid client payload')
  }
  const client = await createClient(parsed.data)
  res.status(201).json(client)
})

clientsRouter.get('/', async (_req, res) => {
  res.json(await listClients())
})

clientsRouter.get('/:id', async (req, res) => {
  res.json(await getClient(req.params.id))
})

clientsRouter.patch('/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid client payload')
  }
  res.json(await updateClient(req.params.id, parsed.data))
})

clientsRouter.delete('/:id', async (req, res) => {
  await deleteClient(req.params.id)
  res.status(204).send()
})
