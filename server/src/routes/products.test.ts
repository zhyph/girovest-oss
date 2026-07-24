import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from '../app.js'
import { prisma } from '../db/client.js'
import { signStaffToken } from '../auth/jwt.js'

let locationId: string
let staffToken: string
let productId: string
let photosDir: string
let originalPhotosDir: string | undefined

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  locationId = location.id
  const staff = await prisma.staff.create({
    data: { name: 'S', login: `staff-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId },
  })
  staffToken = signStaffToken({ staffId: staff.id, role: 'staff' })
  const product = await prisma.product.create({
    data: { locationId, name: 'P', category: 'festa', size: 'M', color: 'azul', rentalPrice: 100, depositAmount: 50 },
  })
  productId = product.id

  photosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-photos-route-test-'))
  originalPhotosDir = process.env.PRODUCT_PHOTOS_DIR
  process.env.PRODUCT_PHOTOS_DIR = photosDir
})

afterEach(async () => {
  process.env.PRODUCT_PHOTOS_DIR = originalPhotosDir
  fs.rmSync(photosDir, { recursive: true, force: true })
  await prisma.productPhotoToken.deleteMany()
  await prisma.allocation.deleteMany()
  await prisma.product.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('POST /:id/photo-token', () => {
  it("issues a token for a product in the caller's own location", async () => {
    const response = await request(app)
      .post(`/api/products/${productId}/photo-token`)
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(201)
    expect(typeof response.body.token).toBe('string')
    expect(typeof response.body.expiresAt).toBe('string')
    expect(typeof response.body.port).toBe('number')
    expect(Array.isArray(response.body.candidates)).toBe(true)
  })

  it('returns 404 for a product in another location', async () => {
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'B' } })
    const otherProduct = await prisma.product.create({
      data: {
        locationId: otherLocation.id,
        name: 'P2',
        category: 'festa',
        size: 'M',
        color: 'azul',
        rentalPrice: 100,
        depositAmount: 50,
      },
    })

    const response = await request(app)
      .post(`/api/products/${otherProduct.id}/photo-token`)
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(404)

    await prisma.product.delete({ where: { id: otherProduct.id } })
    await prisma.location.delete({ where: { id: otherLocation.id } })
  })
})

describe('GET /:id/photos/:filename', () => {
  it('serves a photo file that was written to PRODUCT_PHOTOS_DIR', async () => {
    const filename = 'abc123.jpg'
    fs.writeFileSync(path.join(photosDir, filename), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))

    const response = await request(app)
      .get(`/api/products/${productId}/photos/${filename}`)
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('image/jpeg')
  })

  it('returns 404 for a nonexistent filename', async () => {
    const response = await request(app)
      .get(`/api/products/${productId}/photos/nonexistent.jpg`)
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(404)
  })

  it('rejects a filename containing path traversal characters, not a filesystem read', async () => {
    const response = await request(app)
      .get(`/api/products/${productId}/photos/${encodeURIComponent('../../etc/passwd')}`)
      .set('Authorization', `Bearer ${staffToken}`)

    // The traversal payload never matches PHOTO_FILENAME_PATTERN, so it is
    // rejected by the same NOT_FOUND branch as any other unknown filename —
    // the filesystem is never touched with attacker-controlled input.
    expect(response.status).toBe(404)
  })

  it('rejects a request with no auth token', async () => {
    const response = await request(app).get(`/api/products/${productId}/photos/abc123.jpg`)
    expect(response.status).toBe(401)
  })
})
