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

// Mirrors server.ts's own binding decision exactly: when the main app is
// bound to 0.0.0.0 (the standalone/non-Electron default), signingApp never
// binds anywhere at all, and a candidate whose address equals the main
// app's specific host is skipped too. Reporting a candidate here that
// signingApp didn't actually bind to would have the desktop generate a
// working-looking QR code for an address nothing is listening on.
export function reachableSigningCandidates(): ReturnType<typeof detectLanCandidates> {
  const host = process.env.HOST ?? '0.0.0.0'
  if (host === '0.0.0.0') return []
  return detectLanCandidates().filter((candidate) => candidate.address !== host)
}

contractsRouter.get('/', async (req, res) => {
  if (!req.staff) throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Unauthorized')
  const locationId = await resolveLocationId(req.staff.staffId)
  const page = Number(req.query.page ?? 1)
  const pageSize = Number(req.query.pageSize ?? 20)
  const search = typeof req.query.search === 'string' ? req.query.search : ''
  res.json(await listContracts(locationId, { page, pageSize, search }))
})

contractsRouter.get('/:id', async (req, res) => {
  if (!req.staff) throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Unauthorized')
  const locationId = await resolveLocationId(req.staff.staffId)
  res.json(await getContract(req.params.id, locationId))
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
  if (!req.staff) throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Unauthorized')
  const locationId = await resolveLocationId(req.staff.staffId)
  res.json(await cancelContract(req.params.id, locationId))
})

contractsRouter.post('/:id/sign-token', async (req, res) => {
  if (!req.staff) throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Unauthorized')
  const locationId = await resolveLocationId(req.staff.staffId)
  const { token, expiresAt } = await issueSigningToken(req.params.id, locationId)
  res.status(201).json({
    token,
    expiresAt,
    port: Number(process.env.PORT ?? 3000),
    candidates: reachableSigningCandidates(),
  })
})
