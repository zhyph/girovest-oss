import fs from 'fs'
import path from 'path'
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/authMiddleware.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { prisma } from '../db/client.js'
import { productCreateSchema } from '../lib/productValidation.js'
import {
  createProduct,
  listProducts,
  getProduct,
  updateProduct,
  deleteProduct,
} from '../services/productService.js'
import { issueProductPhotoSession } from '../services/productPhotoTokenService.js'
import { mintSseTicket } from '../services/sseTicketService.js'
import { reachableSigningCandidates } from './contracts.js'
import { openRelayConnection } from '../network/relayClient.js'
import { relayCredentialsFromEnv } from '../network/relayResume.js'
import { registerRelayConnection } from '../network/relayRegistry.js'

export const productsRouter = Router()
productsRouter.use(requireAuth)

// Shared with the phone's token-authorized create route so both paths accept
// exactly the same product; only the two fields the phone can't supply are
// added here.
const createSchema = productCreateSchema.extend({
  locationId: z.string().min(1),
  photos: z.array(z.string()).optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  category: z.string().min(1).optional(),
  size: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  rentalPrice: z.number().positive().optional(),
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

productsRouter.post('/photo-session', async (req, res) => {
  if (!req.staff) throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Unauthorized')
  const { token, expiresAt } = await issueProductPhotoSession(req.staff.staffId, req.staff.locationId)

  const location = await prisma.location.findUniqueOrThrow({ where: { id: req.staff.locationId } })
  if (location.connectivityMode === 'relay') {
    const credentials = await relayCredentialsFromEnv()
    if (credentials) {
      const connection = openRelayConnection(token, credentials)
      // Same as the signing route: don't hand out a QR that can only ever
      // produce a 504 on the phone — say so on the desktop, where staff can
      // act on it.
      if (!(await connection.opened)) {
        connection.close()
        return res.status(201).json({ token, expiresAt, mode: 'relay', relayUnavailable: true })
      }
      // A new photo-session token is minted every time this modal is opened
      // or "Gerar novo código" is pressed; registering makes each one's socket
      // close at expiresAt (or at shutdown) instead of accumulating all day.
      registerRelayConnection(token, connection, expiresAt)
      return res
        .status(201)
        .json({ token, expiresAt, mode: 'relay', relayUrl: `${credentials.url}/relay/${token}/photos` })
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

productsRouter.post('/events/ticket', async (req, res) => {
  if (!req.staff) throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Unauthorized')
  const { ticket, expiresAt } = mintSseTicket(req.staff.staffId, req.staff.locationId)
  res.status(201).json({ ticket, expiresAt })
})

// Filenames are always crypto.randomUUID() + '.jpg', generated only by
// productPhotoTokenService — this pattern rejects anything else (including
// path traversal) before it ever reaches the filesystem.
const PHOTO_FILENAME_PATTERN = /^[0-9a-f-]+\.jpg$/

productsRouter.get('/:id/photos/:filename', async (req, res) => {
  if (!PHOTO_FILENAME_PATTERN.test(req.params.filename)) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo not found')
  }
  const dir = process.env.PRODUCT_PHOTOS_DIR ?? './product-photos'
  const root = path.resolve(dir)
  const filePath = path.join(root, req.params.filename)
  if (!fs.existsSync(filePath)) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo not found')
  }
  res.set('Content-Type', 'image/jpeg')
  // Must pass `root` explicitly: without it, the `send` library (which
  // res.sendFile delegates to) dotfile-checks every segment of the *absolute*
  // path, including ancestor directories that have nothing to do with the
  // served content (e.g. this repo's own `.claude/worktrees/...` layout) —
  // that falsely 404s (masked as a generic 500 by errorMiddleware) any time
  // the app happens to run from inside a dot-prefixed directory. Passing
  // `root` makes `send` dotfile-check only the path relative to it, matching
  // the intent of PHOTO_FILENAME_PATTERN's own traversal guard above.
  res.sendFile(req.params.filename, { root })
})
