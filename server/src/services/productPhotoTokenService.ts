import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

const TOKEN_TTL_MS = 15 * 60 * 1000

function photosDir(): string {
  const dir = process.env.PRODUCT_PHOTOS_DIR ?? './product-photos'
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Constrained to exactly what the phone page's canvas.toDataURL('image/jpeg', ...)
// produces (mirrors signingApp's SIGNATURE_IMAGE_PATTERN reasoning) — this data
// ultimately gets base64-decoded and written to disk as a real file, so anything
// other than a well-formed JPEG data URL must be rejected before it ever reaches
// the filesystem.
const PHOTO_DATA_URL_PATTERN = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/

export async function issueProductPhotoToken(
  productId: string,
  locationId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product || product.locationId !== locationId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${productId} not found`)
  }

  // Same reissue rule as signingService.issueSigningToken: only ever one live
  // unclaimed token per product, and reissuing never deletes an already-claimed
  // row out from under a submitPhotos call that already claimed it.
  await prisma.productPhotoToken.deleteMany({ where: { productId, usedAt: null } })

  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)
  await prisma.productPhotoToken.create({ data: { token, productId, expiresAt } })
  return { token, expiresAt }
}

export async function checkTokenValidity(token: string): Promise<'valid' | 'expired' | 'used' | 'not_found'> {
  const photoToken = await prisma.productPhotoToken.findUnique({ where: { token } })
  if (!photoToken) return 'not_found'
  if (photoToken.usedAt) return 'used'
  if (photoToken.expiresAt.getTime() < Date.now()) return 'expired'
  return 'valid'
}

export async function submitPhotos(token: string, photos: string[]): Promise<void> {
  const now = new Date()

  // Atomic claim, identical reasoning to signingService.submitSignature: the
  // WHERE clause only matches an actually-valid, unclaimed token, and the
  // update itself is what claims it, so two concurrent submits with the same
  // token can never both succeed.
  const result = await prisma.productPhotoToken.updateMany({
    where: { token, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  })

  if (result.count === 0) {
    const status = await checkTokenValidity(token)
    if (status === 'not_found') {
      throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo token not found')
    }
    throw new AppError(ErrorCodes.PHOTO_TOKEN_INVALID, 410, `Photo token is ${status}`)
  }

  const photoToken = await prisma.productPhotoToken.findUniqueOrThrow({ where: { token } })
  const dir = photosDir()
  const writtenPaths: string[] = []
  for (const photo of photos) {
    const match = photo.match(PHOTO_DATA_URL_PATTERN)
    if (!match) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid photo payload')
    }
    const filename = `${crypto.randomUUID()}.jpg`
    fs.writeFileSync(path.join(dir, filename), Buffer.from(match[1], 'base64'))
    // Stored as the authenticated API path (matching the GET /:id/photos/:filename
    // route below and client/src/lib/useAuthenticatedImageUrl.ts's contract), not a
    // bare filename — the client's PhotoThumbnail only treats a path starting with
    // '/api/' as one that needs an authenticated fetch; anything else is rendered as
    // a literal <img src>, which a bare filename is not.
    writtenPaths.push(`/api/products/${photoToken.productId}/photos/${filename}`)
  }

  const product = await prisma.product.findUniqueOrThrow({ where: { id: photoToken.productId } })
  const existingPhotos = JSON.parse(product.photos) as string[]
  await prisma.product.update({
    where: { id: photoToken.productId },
    data: { photos: JSON.stringify([...existingPhotos, ...writtenPaths]) },
  })
}
