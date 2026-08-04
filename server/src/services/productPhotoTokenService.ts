import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { prisma } from '../db/client.js'
import { scopedDb } from '../db/scopedClient.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { productPhotoEvents } from '../events/productPhotoEvents.js'
import { createProduct, type CreateProductInput, type ProductDTO } from './productService.js'

const SESSION_TTL_MS = 12 * 60 * 60 * 1000

function photosDir(): string {
  const dir = process.env.PRODUCT_PHOTOS_DIR ?? './product-photos'
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const PHOTO_DATA_URL_PATTERN = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/

/**
 * Roughly 10 MB of decoded image per photo. Base64 costs a third on the wire,
 * which is what the route's own body limit accounts for.
 */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024

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
 */
export function storePhotoDataUrls(productId: string, photos: string[]): string[] {
  const dir = photosDir()
  const writtenPaths: string[] = []
  for (const photo of photos) {
    const match = photo.match(PHOTO_DATA_URL_PATTERN)
    if (!match) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid photo payload')
    }
    const bytes = Buffer.from(match[1], 'base64')
    if (bytes.byteLength > MAX_PHOTO_BYTES) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Photo is too large')
    }
    const filename = `${crypto.randomUUID()}.jpg`
    fs.writeFileSync(path.join(dir, filename), bytes)
    writtenPaths.push(`/api/products/${productId}/photos/${filename}`)
  }
  return writtenPaths
}

/**
 * Appends already-decoded photos to a product and announces them, scoped to
 * one location. The desktop picker's entry point; submitPhotos below is the
 * phone's, and the two meet here so a photo behaves identically either way.
 */
export async function appendProductPhotos(
  locationId: string,
  productId: string,
  photos: string[],
): Promise<{ photos: string[] }> {
  const product = await scopedDb(locationId).product.findUnique({ where: { id: productId } })
  if (!product || product.locationId !== locationId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${productId} not found`)
  }

  const writtenPaths = storePhotoDataUrls(productId, photos)
  const existingPhotos = JSON.parse(product.photos) as string[]
  const updatedPhotos = [...existingPhotos, ...writtenPaths]
  await scopedDb(locationId).product.update({
    where: { id: productId },
    data: { photos: JSON.stringify(updatedPhotos) },
  })

  productPhotoEvents.emit('photo', { productId, locationId, photos: updatedPhotos })

  return { photos: updatedPhotos }
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
