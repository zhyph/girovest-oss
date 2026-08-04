import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../db/client.js'
import { scopedDb } from '../db/scopedClient.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { productPhotoEvents } from '../events/productPhotoEvents.js'
import { PHOTO_BASE64_MAX_LENGTH } from '../lib/signingValidation.js'
import { createProduct, type CreateProductInput, type ProductDTO } from './productService.js'

const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const MAX_WRITE_CONFLICT_RETRIES = 5

function photosDir(): string {
  const dir = process.env.PRODUCT_PHOTOS_DIR ?? './product-photos'
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const PHOTO_DATA_URL_PATTERN = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/

// Filenames this service ever writes; also what the serving route requires
// before touching the filesystem (routes/products.ts), and what
// removeOrphanedPhotoFiles below requires before unlinking anything.
export const PHOTO_FILENAME_PATTERN = /^[0-9a-f-]+\.jpg$/

/**
 * The largest a validly-shaped photo can decode to, derived from the
 * schema's own base64-character cap (PHOTO_BASE64_MAX_LENGTH) rather than a
 * separate number — base64 costs a third on the wire, so anything past this
 * already failed schema validation before reaching here; this is a second,
 * independent check on the actual decoded bytes.
 */
const MAX_PHOTO_BYTES = Math.floor((PHOTO_BASE64_MAX_LENGTH * 3) / 4)

function isJpegSignature(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

/**
 * Writes photos to disk and hands back the URL paths they are served from.
 *
 * The single place a product photo is ever created, shared by the phone's
 * intake page and by the desktop's own file picker. Both must produce exactly
 * the same thing — a JPEG under PRODUCT_PHOTOS_DIR, named
 * `<uuid>.jpg`, referenced as `/api/products/<id>/photos/<uuid>.jpg` — because
 * everything downstream (the serving route's filename pattern, the zoom
 * panel, the SSE live update) reads that shape and nothing else. Two intake
 * paths writing two shapes is how the serving route would start needing to
 * know where a photo came from.
 *
 * Every photo in the batch is validated and decoded FIRST, and only written
 * once the whole batch passes — a batch with one malformed entry among
 * several valid ones used to leave the valid ones' files on disk with
 * nothing in product.photos ever pointing at them, because the old version
 * wrote as it validated instead of validating first.
 */
export async function storePhotoDataUrls(productId: string, photos: string[]): Promise<string[]> {
  const dir = photosDir()

  const decoded = photos.map((photo) => {
    const match = photo.match(PHOTO_DATA_URL_PATTERN)
    if (!match) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid photo payload')
    }
    const bytes = Buffer.from(match[1], 'base64')
    if (bytes.byteLength > MAX_PHOTO_BYTES) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Photo is too large')
    }
    // The data-URL prefix is caller-declared, not verified on its own — check
    // the actual bytes carry a JPEG signature before writing anything that
    // later gets served back with Content-Type: image/jpeg.
    if (!isJpegSignature(bytes)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Photo is not a valid JPEG')
    }
    return bytes
  })

  const writtenPaths: string[] = []
  try {
    for (const bytes of decoded) {
      const filename = `${crypto.randomUUID()}.jpg`
      await fs.promises.writeFile(path.join(dir, filename), bytes)
      writtenPaths.push(`/api/products/${productId}/photos/${filename}`)
    }
  } catch (error) {
    // Roll back whatever this batch already wrote rather than leaving
    // orphans from a write that failed partway through (e.g. disk full).
    await Promise.all(
      writtenPaths.map((entry) => fs.promises.unlink(path.join(dir, entry.split('/').pop()!)).catch(() => {})),
    )
    throw error
  }
  return writtenPaths
}

/**
 * Deletes photo files that no longer appear in a product's photo list — e.g.
 * after the drawer's "Remover" button — so years of catalogue photo churn
 * don't grow PRODUCT_PHOTOS_DIR without bound. Only unlinks entries matching
 * this service's own served-photo shape; anything else is left alone rather
 * than guessed at.
 */
export async function removeOrphanedPhotoFiles(previousPhotos: string[], nextPhotos: string[]): Promise<void> {
  const next = new Set(nextPhotos)
  const removed = previousPhotos.filter((entry) => !next.has(entry))
  if (removed.length === 0) return
  const dir = photosDir()
  await Promise.all(
    removed.map(async (entry) => {
      const filename = entry.split('/').pop()
      if (!filename || !PHOTO_FILENAME_PATTERN.test(filename)) return
      await fs.promises.unlink(path.join(dir, filename)).catch(() => {})
    }),
  )
}

/**
 * Appends photos to a product and announces them, scoped to one location.
 * The desktop picker's entry point; submitPhotos below is the phone's, and
 * the two meet here so a photo behaves identically either way.
 *
 * The read-modify-write of `product.photos` runs inside a serializable
 * transaction with retry (mirroring contractService.ts's own numbering
 * pattern): the phone intake and the desktop picker can now legitimately
 * both add photos to the same product at once, and without this a second
 * writer's read-before-the-first-writer's-update would silently drop the
 * first writer's addition from the array.
 */
export async function appendProductPhotos(
  locationId: string,
  productId: string,
  photos: string[],
): Promise<{ photos: string[] }> {
  const initial = await scopedDb(locationId).product.findUnique({ where: { id: productId } })
  if (!initial || initial.locationId !== locationId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${productId} not found`)
  }

  const writtenPaths = await storePhotoDataUrls(productId, photos)
  const useSerializable = process.env.DB_PROVIDER === 'postgresql'

  for (let attempt = 0; attempt < MAX_WRITE_CONFLICT_RETRIES; attempt++) {
    try {
      const updatedPhotos = await prisma.$transaction(
        async (tx) => {
          // scopedDb wraps the top-level prisma client, not a transaction's
          // tx — it cannot reach in here. Safe unscoped only because the
          // very next line re-verifies locationId by hand before any read
          // of product.photos is trusted or any write happens, mirroring
          // clientService.ts's updateClient() precedent for the same
          // limitation.
          // ast-grep-ignore: no-unscoped-location-model — re-verified against locationId on the next line before use; scopedDb cannot wrap a transaction's tx.
          const product = await tx.product.findUnique({ where: { id: productId } })
          if (!product || product.locationId !== locationId) {
            throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${productId} not found`)
          }
          const existingPhotos = JSON.parse(product.photos) as string[]
          const next = [...existingPhotos, ...writtenPaths]
          // ast-grep-ignore: no-unscoped-location-model — id was just proven to belong to locationId by the findUnique check above; the update can only ever touch that same row.
          await tx.product.update({ where: { id: productId }, data: { photos: JSON.stringify(next) } })
          return next
        },
        useSerializable ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } : undefined,
      )

      productPhotoEvents.emit('photo', { productId, locationId, photos: updatedPhotos })
      return { photos: updatedPhotos }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) {
        continue
      }
      throw error
    }
  }

  throw new AppError(ErrorCodes.VALIDATION_ERROR, 409, 'Could not save photos due to repeated write conflicts, please retry')
}

export async function issueProductPhotoSession(
  staffId: string,
  locationId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await prisma.productPhotoToken.create({ data: { token, staffId, locationId, expiresAt } })
  return { token, expiresAt }
}

export async function checkTokenValidity(token: string): Promise<'valid' | 'expired' | 'not_found'> {
  const photoToken = await prisma.productPhotoToken.findUnique({ where: { token } })
  if (!photoToken) return 'not_found'
  if (photoToken.expiresAt.getTime() < Date.now()) return 'expired'
  return 'valid'
}

// Unlike the signing-token pattern this was originally modeled on, this
// token is intentionally reusable — no claim/consume step. Only expiry
// invalidates it. See docs/superpowers/specs/2026-07-24-photo-intake-session-redesign.md
// for why this tradeoff is accepted (LAN-only, shift-bound TTL).
async function requireValidToken(token: string): Promise<{ locationId: string }> {
  const photoToken = await prisma.productPhotoToken.findUnique({ where: { token } })
  if (!photoToken) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo token not found')
  }
  if (photoToken.expiresAt.getTime() < Date.now()) {
    throw new AppError(ErrorCodes.PHOTO_TOKEN_INVALID, 410, 'Photo token is expired')
  }
  return photoToken
}

export async function submitPhotos(
  token: string,
  productId: string,
  photos: string[],
): Promise<{ photos: string[] }> {
  const photoToken = await requireValidToken(token)
  return appendProductPhotos(photoToken.locationId, productId, photos)
}

export type CreateProductFromPhotoTokenInput = Omit<CreateProductInput, 'locationId' | 'photos'>

// The token is the ONLY credential the phone has, so every field that decides
// *where* the row lands must come from the token row rather than the request.
// Each field is passed explicitly (no spread) so a hostile body carrying its
// own `locationId` can never reach Prisma.
export async function createProductFromPhotoToken(
  token: string,
  input: CreateProductFromPhotoTokenInput,
): Promise<ProductDTO> {
  const photoToken = await requireValidToken(token)

  const product = await createProduct({
    locationId: photoToken.locationId,
    name: input.name,
    description: input.description,
    category: input.category,
    size: input.size,
    color: input.color,
    rentalPrice: input.rentalPrice,
    depositAmount: input.depositAmount,
  })

  productPhotoEvents.emit('product-created', { locationId: photoToken.locationId, product })

  return product
}
