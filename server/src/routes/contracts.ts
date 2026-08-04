import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/authMiddleware.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { prisma } from '../db/client.js'
import {
  createContract,
  cancelContract,
  listContracts,
  getContract,
  setInstallmentPaid,
  sumReceivables,
  CONTRACT_STATUS_FILTERS,
} from '../services/contractService.js'
import { issueSigningToken } from '../services/signingService.js'
import { detectLanCandidates } from '../network/lanNetwork.js'
import { openRelayConnection } from '../network/relayClient.js'
import { relayCredentialsFromEnv } from '../network/relayResume.js'
import { registerRelayConnection } from '../network/relayRegistry.js'
import { isoDate } from '../lib/zodDate.js'

export const contractsRouter = Router()
contractsRouter.use(requireAuth)

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

const listQuerySchema = z.object({
  status: z.enum(CONTRACT_STATUS_FILTERS).optional(),
  // The caller's "now". Overdue is the one view that depends on it, and the
  // desktop's clock is what the badge beside the row already compares
  // against — deriving it here instead would let the chip and the badge
  // disagree on a contract due today.
  asOf: isoDate.optional(),
})

contractsRouter.get('/', async (req, res) => {
  if (!req.staff) throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Unauthorized')
  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid contract list query')
  }
  const locationId = req.staff.locationId
  const page = Number(req.query.page ?? 1)
  const pageSize = Number(req.query.pageSize ?? 20)
  const search = typeof req.query.search === 'string' ? req.query.search : ''
  res.json(
    await listContracts(locationId, {
      page,
      pageSize,
      search,
      status: parsed.data.status,
      asOf: parsed.data.asOf,
    }),
  )
})

const receivablesSchema = z.object({ from: isoDate, to: isoDate })

// Two path segments, so it can never be swallowed by `/:id` below — but it is
// declared first anyway, so that reordering the file can't silently turn this
// into a contract lookup for the id "installments".
contractsRouter.get('/installments/receivable', async (req, res) => {
  if (!req.staff) throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Unauthorized')
  const parsed = receivablesSchema.safeParse(req.query)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'from and to query params are required')
  }
  res.json(await sumReceivables(req.staff.locationId, parsed.data.from, parsed.data.to))
})

contractsRouter.get('/:id', async (req, res) => {
  if (!req.staff) throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Unauthorized')
  const locationId = req.staff.locationId
  res.json(await getContract(req.params.id, locationId))
})

const itemSchema = z.object({
  productId: z.string().min(1),
  checkoutDate: isoDate,
  dueDate: isoDate,
  priceCharged: z.number().nonnegative(),
})

const installmentSchema = z.object({
  dueDate: isoDate,
  amount: z.number().nonnegative(),
})

const createSchema = z.object({
  clientId: z.string().min(1),
  eventDate: isoDate,
  paymentMethod: z.string().min(1),
  items: z.array(itemSchema).min(1),
  installments: z.array(installmentSchema),
})

contractsRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success || !req.staff) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid contract payload')
  }
  const locationId = req.staff.locationId
  const contract = await createContract({ ...parsed.data, locationId, staffId: req.staff.staffId })
  res.status(201).json(contract)
})

contractsRouter.post('/:id/cancel', async (req, res) => {
  if (!req.staff) throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Unauthorized')
  const locationId = req.staff.locationId
  res.json(await cancelContract(req.params.id, locationId))
})

const installmentPaidSchema = z.object({ paid: z.boolean() })

contractsRouter.patch('/:contractId/installments/:installmentId', async (req, res) => {
  if (!req.staff) throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Unauthorized')
  const parsed = installmentPaidSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid installment payload')
  }
  const locationId = req.staff.locationId
  res.json(
    await setInstallmentPaid(req.params.contractId, req.params.installmentId, locationId, parsed.data.paid),
  )
})

contractsRouter.post('/:id/sign-token', async (req, res) => {
  if (!req.staff) throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Unauthorized')
  const locationId = req.staff.locationId
  const { token, expiresAt } = await issueSigningToken(req.params.id, locationId)

  const location = await prisma.location.findUniqueOrThrow({ where: { id: locationId } })
  if (location.connectivityMode === 'relay') {
    const credentials = await relayCredentialsFromEnv()
    if (credentials) {
      const connection = openRelayConnection(token, credentials)
      // The QR is worthless until the shop side is actually connected: with a
      // wrong product key, a revoked install or no internet, the only symptom
      // used to be the phone getting a 504 ten seconds after scanning. Wait
      // for the handshake and report the failure on the desktop instead.
      if (!(await connection.opened)) {
        connection.close()
        return res.status(201).json({ token, expiresAt, mode: 'relay', relayUnavailable: true })
      }
      // Registered so it is closed at expiresAt or at shutdown — never left
      // reconnecting for the life of the process. Deliberately not closed when
      // the signature lands: the phone pages' relayed `sign/status` check runs
      // over this socket, so an already-signed link needs it to still be there.
      registerRelayConnection(token, connection, expiresAt)
      return res
        .status(201)
        .json({ token, expiresAt, mode: 'relay', relayUrl: `${credentials.url}/relay/${token}/sign` })
    }
  }

  res.status(201).json({
    token,
    expiresAt,
    mode: 'lan',
    port: Number(process.env.PORT ?? 3000),
    candidates: reachableSigningCandidates(),
  })
})
