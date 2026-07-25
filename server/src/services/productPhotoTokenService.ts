import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { productPhotoEvents } from '../events/productPhotoEvents.js'

const SESSION_TTL_MS = 12 * 60 * 60 * 1000

function photosDir(): string {
  const dir = process.env.PRODUCT_PHOTOS_DIR ?? './product-photos'
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const PHOTO_DATA_URL_PATTERN = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/

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
export async function submitPhotos(
  token: string,
  productId: string,
  photos: string[],
): Promise<{ photos: string[] }> {
  const photoToken = await prisma.productPhotoToken.findUnique({ where: { token } })
  if (!photoToken) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo token not found')
  }
  if (photoToken.expiresAt.getTime() < Date.now()) {
    throw new AppError(ErrorCodes.PHOTO_TOKEN_INVALID, 410, 'Photo token is expired')
  }

  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product || product.locationId !== photoToken.locationId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${productId} not found`)
  }

  const dir = photosDir()
  const writtenPaths: string[] = []
  for (const photo of photos) {
    const match = photo.match(PHOTO_DATA_URL_PATTERN)
    if (!match) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid photo payload')
    }
    const filename = `${crypto.randomUUID()}.jpg`
    fs.writeFileSync(path.join(dir, filename), Buffer.from(match[1], 'base64'))
    writtenPaths.push(`/api/products/${productId}/photos/${filename}`)
  }

  const existingPhotos = JSON.parse(product.photos) as string[]
  const updatedPhotos = [...existingPhotos, ...writtenPaths]
  await prisma.product.update({
    where: { id: productId },
    data: { photos: JSON.stringify(updatedPhotos) },
  })

  productPhotoEvents.emit('photo', { productId, locationId: photoToken.locationId, photos: updatedPhotos })

  return { photos: updatedPhotos }
}
