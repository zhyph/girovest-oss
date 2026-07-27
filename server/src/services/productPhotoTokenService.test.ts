import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import {
  issueProductPhotoSession,
  checkTokenValidity,
  submitPhotos,
  createProductFromPhotoToken,
} from './productPhotoTokenService.js'
import { productPhotoEvents } from '../events/productPhotoEvents.js'

const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=='

let photosDir: string

// This file's own fixtures for the `findFirstOrThrow()` calls below to find —
// each test file in this suite seeds its own baseline data rather than
// relying on another file's leftovers, since files clean up after themselves.
beforeEach(async () => {
  photosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-photo-test-'))
  process.env.PRODUCT_PHOTOS_DIR = photosDir
  await prisma.productPhotoToken.deleteMany()

  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  await prisma.staff.create({
    data: { name: 'S', login: `staff-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId: location.id },
  })
  await prisma.product.create({
    data: { locationId: location.id, name: 'P', category: 'festa', size: 'M', color: 'azul', rentalPrice: 100, depositAmount: 50 },
  })
})

afterEach(async () => {
  fs.rmSync(photosDir, { recursive: true, force: true })
  delete process.env.PRODUCT_PHOTOS_DIR
  await prisma.productPhotoToken.deleteMany()
  await prisma.product.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('issueProductPhotoSession', () => {
  it('issues a token scoped to the given staff and location', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const { token, expiresAt } = await issueProductPhotoSession(staff.id, staff.locationId)
    expect(token).toHaveLength(43) // base64url(32 random bytes)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(await checkTokenValidity(token)).toBe('valid')
  })

  it('does not invalidate a previously issued still-valid token for the same staff', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const first = await issueProductPhotoSession(staff.id, staff.locationId)
    await issueProductPhotoSession(staff.id, staff.locationId)
    // Unlike the old single-use-per-product model, issuing a new session
    // token does NOT invalidate a prior one — multiple concurrent sessions
    // for the same staff are harmless and not worth guarding against.
    expect(await checkTokenValidity(first.token)).toBe('valid')
  })
})

describe('submitPhotos', () => {
  it('accepts multiple submits with the same token (not single-use)', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const product = await prisma.product.findFirstOrThrow({ where: { locationId: staff.locationId } })
    const { token } = await issueProductPhotoSession(staff.id, staff.locationId)

    await submitPhotos(token, product.id, [TINY_JPEG])
    await submitPhotos(token, product.id, [TINY_JPEG]) // second submit, same token — must succeed

    const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    expect((JSON.parse(updated.photos) as string[]).length).toBeGreaterThanOrEqual(2)
  })

  it('rejects a productId belonging to a different location than the token', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const { token } = await issueProductPhotoSession(staff.id, staff.locationId)
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'X' } })
    const otherProduct = await prisma.product.create({
      data: { locationId: otherLocation.id, name: 'X', category: 'x', size: 'x', color: 'x', rentalPrice: 1, depositAmount: 1 },
    })

    await expect(submitPhotos(token, otherProduct.id, [TINY_JPEG])).rejects.toThrow(AppError)
  })

  it('rejects an expired token', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const product = await prisma.product.findFirstOrThrow({ where: { locationId: staff.locationId } })
    const { token } = await issueProductPhotoSession(staff.id, staff.locationId)
    await prisma.productPhotoToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } })

    await expect(submitPhotos(token, product.id, [TINY_JPEG])).rejects.toThrow(AppError)
  })

  it('rejects an unknown token', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const product = await prisma.product.findFirstOrThrow({ where: { locationId: staff.locationId } })
    await expect(submitPhotos('unknown-token', product.id, [TINY_JPEG])).rejects.toThrow(AppError)
  })

  it('returns the product\'s full updated photos array', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const product = await prisma.product.findFirstOrThrow()
    const { token } = await issueProductPhotoSession(staff.id, staff.locationId)

    const result = await submitPhotos(token, product.id, [TINY_JPEG])

    expect(result.photos).toHaveLength(1)
    expect(result.photos[0]).toMatch(new RegExp(`^/api/products/${product.id}/photos/[0-9a-f-]+\\.jpg$`))
  })

  it('emits a photo event with the product id, location id, and updated photos', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const product = await prisma.product.findFirstOrThrow()
    const { token } = await issueProductPhotoSession(staff.id, staff.locationId)

    const received: unknown[] = []
    const listener = (event: unknown) => received.push(event)
    productPhotoEvents.on('photo', listener)
    try {
      const result = await submitPhotos(token, product.id, [TINY_JPEG])
      expect(received).toEqual([{ productId: product.id, locationId: staff.locationId, photos: result.photos }])
    } finally {
      productPhotoEvents.off('photo', listener)
    }
  })
})

const NEW_PRODUCT = {
  name: 'Vestido Novo',
  category: 'festa',
  size: 'G',
  color: 'vermelho',
  rentalPrice: 250,
  depositAmount: 125,
}

describe('createProductFromPhotoToken', () => {
  it('creates the product at the token\'s location and returns a photo-ready DTO', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const { token } = await issueProductPhotoSession(staff.id, staff.locationId)

    const product = await createProductFromPhotoToken(token, NEW_PRODUCT)

    expect(product.locationId).toBe(staff.locationId)
    expect(product.name).toBe('Vestido Novo')
    expect(product.photos).toEqual([])
    expect(product.status).toBe('active')
    expect(product.availability).toBe('available')
    expect(product.hasAllocationHistory).toBe(false)
    const row = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(row.locationId).toBe(staff.locationId)
  })

  it('takes the location from the token, never from the caller-supplied input', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const { token } = await issueProductPhotoSession(staff.id, staff.locationId)
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'X' } })

    const product = await createProductFromPhotoToken(token, {
      ...NEW_PRODUCT,
      locationId: otherLocation.id,
    } as never)

    expect(product.locationId).toBe(staff.locationId)
    expect(product.locationId).not.toBe(otherLocation.id)
  })

  it('rejects an unknown token', async () => {
    await expect(createProductFromPhotoToken('unknown-token', NEW_PRODUCT)).rejects.toThrow(AppError)
    expect(await prisma.product.count({ where: { name: NEW_PRODUCT.name } })).toBe(0)
  })

  it('rejects an expired token', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const { token } = await issueProductPhotoSession(staff.id, staff.locationId)
    await prisma.productPhotoToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } })

    await expect(createProductFromPhotoToken(token, NEW_PRODUCT)).rejects.toThrow(AppError)
    expect(await prisma.product.count({ where: { name: NEW_PRODUCT.name } })).toBe(0)
  })

  it('emits exactly one product-created event carrying the location and the full product', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const { token } = await issueProductPhotoSession(staff.id, staff.locationId)

    const received: unknown[] = []
    const listener = (event: unknown) => received.push(event)
    productPhotoEvents.on('product-created', listener)
    try {
      const product = await createProductFromPhotoToken(token, NEW_PRODUCT)
      expect(received).toEqual([{ locationId: staff.locationId, product }])
    } finally {
      productPhotoEvents.off('product-created', listener)
    }
  })
})
