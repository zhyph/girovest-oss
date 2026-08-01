import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/authMiddleware.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { createClient, listClients, getClient, updateClient, deleteClient } from '../services/clientService.js'

export const clientsRouter = Router()
clientsRouter.use(requireAuth)

const identityDocumentSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  maskKey: z.string().nullable().optional(),
})

const addressLineSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  sortOrder: z.number().int(),
  maskKey: z.string().nullable().optional(),
})

const createSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.email().or(z.literal('')),
  notes: z.string().optional(),
  identityDocuments: z.array(identityDocumentSchema).optional(),
  addressLines: z.array(addressLineSchema).optional(),
})

const updateSchema = createSchema.partial()

clientsRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid client payload')
  }
  const client = await createClient(req.staff!.locationId, parsed.data)
  res.status(201).json(client)
})

clientsRouter.get('/', async (req, res) => {
  res.json(await listClients(req.staff!.locationId))
})

clientsRouter.get('/:id', async (req, res) => {
  res.json(await getClient(req.staff!.locationId, req.params.id))
})

clientsRouter.patch('/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid client payload')
  }
  res.json(await updateClient(req.staff!.locationId, req.params.id, parsed.data))
})

clientsRouter.delete('/:id', async (req, res) => {
  await deleteClient(req.staff!.locationId, req.params.id)
  res.status(204).send()
})
