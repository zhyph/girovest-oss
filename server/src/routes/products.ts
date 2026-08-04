import fs from 'fs'
import path from 'path'
import express, { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/authMiddleware.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { prisma } from '../db/client.js'
import { productCreateSchema } from '../lib/productValidation.js'
import { uploadPhotosSchema } from '../lib/signingValidation.js'
import {
  createProduct,
  listProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  listLeavingMaintenance,
} from '../services/productService.js'
import {
  appendProductPhotos,
  issueProductPhotoSession,
  PHOTO_FILENAME_PATTERN,
} from '../services/productPhotoTokenService.js'
import { mintSseTicket } from '../services/sseTicketService.js'
import { reachableSigningCandidates } from './contracts.js'
import { openRelayConnection } from '../network/relayClient.js'
import { relayCredentialsFromEnv } from '../network/relayResume.js'
import { registerRelayConnection } from '../network/relayRegistry.js'

export const productsRouter = Router()
productsRouter.use(requireAuth)

// Every photo path a product ever legitimately carries is server-generated
// by productPhotoTokenService (see PHOTO_FILENAME_PATTERN there) and served
// through this router's own /:id/photos/:filename route — never anything
// else. Constraining create/update to that shape closes the last route by
// which a non-`/api/` string (or any other value) could reach `<img src>`.
const STORED_PHOTO_PATH_PATTERN = /^\/api\/products\/[0-9a-f-]+\/photos\/[0-9a-f-]+\.jpg$/

// Shared with the phone's token-authorized create route so both paths accept
// exactly the same product; only the field the phone can't supply is added
// here. locationId is not part of this schema — it always comes from the
// authenticated staff member below, never the request body.
const createSchema = productCreateSchema.extend({
  photos: z.array(z.string().regex(STORED_PHOTO_PATH_PATTERN)).optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  category: z.string().min(1).optional(),
  size: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  rentalPrice: z.number().positive().optional(),
  depositAmount: z.number().nonnegative().optional(),
  photos: z.array(z.string().regex(STORED_PHOTO_PATH_PATTERN)).optional(),
  status: z.enum(['active', 'maintenance', 'retired']).optional(),
})

productsRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid product payload')
  }
  res.status(201).json(await createProduct({ ...parsed.data, locationId: req.staff!.locationId }))
})

productsRouter.get('/', async (req, res) => {
  res.json(await listProducts(req.staff!.locationId))
})

// MUST stay above `/:id` — it is a single path segment, so declaring it after
// would have Express resolve it as a product lookup for the id
// "leaving-maintenance" and answer 404 forever.
productsRouter.get('/leaving-maintenance', async (req, res) => {
  res.json(await listLeavingMaintenance(req.staff!.locationId))
})

productsRouter.get('/:id', async (req, res) => {
  res.json(await getProduct(req.staff!.locationId, req.params.id))
})

productsRouter.patch('/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid product payload')
  }
  res.json(await updateProduct(req.staff!.locationId, req.params.id, parsed.data))
})

productsRouter.delete('/:id', async (req, res) => {
  await deleteProduct(req.staff!.locationId, req.params.id)
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

/**
 * The desktop and web UI's own photo intake, beside the phone's.
 *
 * Deliberately the same JSON-of-data-URLs shape the phone page already posts,
 * rather than multipart/form-data: it lets both paths share one writer
 * (appendProductPhotos), needs no upload-parser dependency in a server that
 * is also packaged inside Electron, and works identically in the packaged
 * desktop build and the hosted web build — the browser downscales to JPEG
 * before sending either way, so a phone photo does not travel at full size.
 * The schema is shared with the phone's submitPhotosSchema (see
 * lib/signingValidation.ts) so the two intake paths can't validate the same
 * payload shape differently.
 *
 * The higher body-size parser below is mounted directly on this route,
 * AFTER `productsRouter.use(requireAuth)` above — not at app level — so an
 * unauthenticated request against this path is rejected before any body
 * larger than the app-wide default limit is ever buffered. See app.ts's own
 * comment for the full reasoning.
 */
productsRouter.post('/:id/photos', express.json({ limit: '12mb' }), async (req, res) => {
  const parsed = uploadPhotosSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid photo payload')
  }
  res.status(201).json(await appendProductPhotos(req.staff!.locationId, req.params.id, parsed.data.photos))
})

// Filenames are always crypto.randomUUID() + '.jpg', generated only by
// productPhotoTokenService (which also owns PHOTO_FILENAME_PATTERN) — this
// pattern rejects anything else (including path traversal) before it ever
// reaches the filesystem.
productsRouter.get('/:id/photos/:filename', async (req, res) => {
  if (!PHOTO_FILENAME_PATTERN.test(req.params.filename)) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo not found')
  }
  const product = await getProduct(req.staff!.locationId, req.params.id)
  // `product.photos` stores full URL paths, not bare filenames -- see
  // productPhotoTokenService.submitPhotos(), which pushes
  // `/api/products/<productId>/photos/<filename>`. Compare against that exact
  // shape; comparing against the bare filename never matches a real row.
  const expectedEntry = `/api/products/${req.params.id}/photos/${req.params.filename}`
  if (!product.photos.includes(expectedEntry)) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo not found')
  }
  const dir = process.env.PRODUCT_PHOTOS_DIR ?? './product-photos'
  const root = path.resolve(dir)
  const filePath = path.join(root, req.params.filename)
  if (!fs.existsSync(filePath)) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo not found')
  }
  res.set('Content-Type', 'image/jpeg')
  // The stored bytes are only checked for a JPEG signature, not fully
  // decoded and re-encoded — nosniff stops a browser from ever reinterpreting
  // a malformed upload as something other than what Content-Type declares.
  res.set('X-Content-Type-Options', 'nosniff')
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
