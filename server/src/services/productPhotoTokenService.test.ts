import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import {
  issueProductPhotoToken,
  checkTokenValidity,
  submitPhotos,
} from './productPhotoTokenService.js'

let productId: string
let locationId: string
let photosDir: string
let originalPhotosDir: string | undefined

const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k='

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  locationId = location.id
  const product = await prisma.product.create({
    data: {
      locationId,
      name: 'P',
      category: 'festa',
      size: 'M',
      color: 'azul',
      rentalPrice: 100,
      depositAmount: 50,
    },
  })
  productId = product.id

  photosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-photos-test-'))
  originalPhotosDir = process.env.PRODUCT_PHOTOS_DIR
  process.env.PRODUCT_PHOTOS_DIR = photosDir
})

afterEach(async () => {
  process.env.PRODUCT_PHOTOS_DIR = originalPhotosDir
  fs.rmSync(photosDir, { recursive: true, force: true })
  await prisma.productPhotoToken.deleteMany()
  await prisma.allocation.deleteMany()
  await prisma.product.deleteMany()
  await prisma.location.deleteMany()
})

describe('issueProductPhotoToken', () => {
  it('creates a token expiring 15 minutes from now', async () => {
    const before = Date.now()
    const { token, expiresAt } = await issueProductPhotoToken(productId, locationId)

    expect(token.length).toBeGreaterThan(20)
    expect(expiresAt.getTime()).toBeGreaterThan(before + 14 * 60 * 1000)
    expect(expiresAt.getTime()).toBeLessThan(before + 16 * 60 * 1000)
  })

  it('invalidates a previously issued token for the same product', async () => {
    const first = await issueProductPhotoToken(productId, locationId)
    const second = await issueProductPhotoToken(productId, locationId)

    expect(await checkTokenValidity(first.token)).toBe('not_found')
    expect(await checkTokenValidity(second.token)).toBe('valid')
  })

  it('throws NOT_FOUND for a missing product', async () => {
    await expect(issueProductPhotoToken('missing-id', locationId)).rejects.toThrow(AppError)
  })

  it('throws NOT_FOUND for a product belonging to another location', async () => {
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'B' } })

    await expect(issueProductPhotoToken(productId, otherLocation.id)).rejects.toThrow(AppError)
  })

  it('does not delete an already-claimed token when reissuing', async () => {
    const { token } = await issueProductPhotoToken(productId, locationId)
    await submitPhotos(token, [TINY_JPEG])

    await issueProductPhotoToken(productId, locationId)

    const claimed = await prisma.productPhotoToken.findUnique({ where: { token } })
    expect(claimed).not.toBeNull()
    expect(claimed?.usedAt).not.toBeNull()
  })
})

describe('checkTokenValidity', () => {
  it('returns not_found for an unknown token', async () => {
    expect(await checkTokenValidity('unknown-token')).toBe('not_found')
  })

  it('returns expired for a token past its expiry', async () => {
    const { token } = await issueProductPhotoToken(productId, locationId)
    await prisma.productPhotoToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } })

    expect(await checkTokenValidity(token)).toBe('expired')
  })

  it('returns used for an already-consumed token', async () => {
    const { token } = await issueProductPhotoToken(productId, locationId)
    await submitPhotos(token, [TINY_JPEG])

    expect(await checkTokenValidity(token)).toBe('used')
  })
})

describe('submitPhotos', () => {
  it('writes photo files to PRODUCT_PHOTOS_DIR and appends their paths to the product', async () => {
    const { token } = await issueProductPhotoToken(productId, locationId)

    await submitPhotos(token, [TINY_JPEG, TINY_JPEG])

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } })
    const photos = JSON.parse(product.photos) as string[]
    expect(photos).toHaveLength(2)
    for (const relativePath of photos) {
      // Must be the authenticated API path (GET /:id/photos/:filename), not a
      // bare filename — the client only treats a path starting with '/api/'
      // (PhotoThumbnail's isRemotePath check) as one needing an authenticated
      // fetch via useAuthenticatedImageUrl; anything else renders as a literal
      // <img src>, which a bare filename can never resolve correctly.
      expect(relativePath).toMatch(new RegExp(`^/api/products/${productId}/photos/[0-9a-f-]+\\.jpg$`))
      expect(fs.existsSync(path.join(photosDir, path.basename(relativePath)))).toBe(true)
    }
  })

  it('appends to existing photos rather than replacing them', async () => {
    await prisma.product.update({ where: { id: productId }, data: { photos: JSON.stringify(['existing.jpg']) } })
    const { token } = await issueProductPhotoToken(productId, locationId)

    await submitPhotos(token, [TINY_JPEG])

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } })
    const photos = JSON.parse(product.photos) as string[]
    expect(photos).toEqual(expect.arrayContaining(['existing.jpg']))
    expect(photos).toHaveLength(2)
  })

  it('marks the token used and rejects a second submit with the same token', async () => {
    const { token } = await issueProductPhotoToken(productId, locationId)
    await submitPhotos(token, [TINY_JPEG])

    await expect(submitPhotos(token, [TINY_JPEG])).rejects.toThrow(AppError)
  })

  it('rejects an expired token', async () => {
    const { token } = await issueProductPhotoToken(productId, locationId)
    await prisma.productPhotoToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } })

    await expect(submitPhotos(token, [TINY_JPEG])).rejects.toThrow(AppError)
  })

  it('rejects an unknown token', async () => {
    await expect(submitPhotos('unknown-token', [TINY_JPEG])).rejects.toThrow(AppError)
  })
})
