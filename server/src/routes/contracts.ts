import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/authMiddleware.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { prisma } from '../db/client.js'
import { createContract, cancelContract, listContracts, getContract } from '../services/contractService.js'
import { issueSigningToken } from '../services/signingService.js'
import { detectLanCandidates } from '../network/lanNetwork.js'

export const contractsRouter = Router()
contractsRouter.use(requireAuth)

// A Contract's locationId drives its per-location sequential number and the
// @@unique([locationId, number]) constraint — it must come from the
// authenticated staff's own location, never from client-supplied input,
// the same way locationSettings.ts's resolveLocationId already does.
async function resolveLocationId(staffId: string): Promise<string> {
  const staff = await prisma.staff.findUniqueOrThrow({ where: { id: staffId } })
  return staff.locationId
}

contractsRouter.get('/', async (_req, res) => {
  res.json(await listContracts())
})

contractsRouter.get('/:id', async (req, res) => {
  res.json(await getContract(req.params.id))
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
  const locationId = await resolveLocationId(req.staff.staffId)
  const contract = await createContract({ ...parsed.data, locationId, staffId: req.staff.staffId })
  res.status(201).json(contract)
})

contractsRouter.post('/:id/cancel', async (req, res) => {
  res.json(await cancelContract(req.params.id))
})

contractsRouter.post('/:id/sign-token', async (req, res) => {
  const { token, expiresAt } = await issueSigningToken(req.params.id)
  res.status(201).json({
    token,
    expiresAt,
    port: Number(process.env.PORT ?? 3000),
    candidates: detectLanCandidates(),
  })
})
