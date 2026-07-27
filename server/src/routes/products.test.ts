import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from '../app.js'
import { prisma } from '../db/client.js'
import jwt from 'jsonwebtoken'
import { SESSION_TTL_SECONDS, signStaffToken } from '../auth/jwt.js'

let locationId: string
let staffToken: string
let agedStaffToken: string
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
  // Same token, but 7h into its 12h life: jsonwebtoken derives exp from a
  // caller-supplied iat, so this is a real past-half-life token, no fake timers.
  agedStaffToken = jwt.sign(
    { staffId: staff.id, role: 'staff', iat: Math.floor(Date.now() / 1000) - 7 * 60 * 60 },
    process.env.JWT_SECRET as string,
    { expiresIn: SESSION_TTL_SECONDS },
  )
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

describe('POST /api/products/photo-session', () => {
  it('issues a session token scoped to the caller\'s own staff/location', async () => {
    const response = await request(app).post('/api/products/photo-session').set('Authorization', `Bearer ${staffToken}`)
    expect(response.status).toBe(201)
    expect(response.body.token).toBeTruthy()
    expect(response.body.candidates).toBeDefined()
  })

  it('requires authentication', async () => {
    const response = await request(app).post('/api/products/photo-session')
    expect(response.status).toBe(401)
  })
})

describe('POST /api/products/events/ticket', () => {
  it('mints a ticket for the authenticated staff', async () => {
    const res = await request(app)
      .post('/api/products/events/ticket')
      .set('Authorization', `Bearer ${staffToken}`)
    expect(res.status).toBe(201)
    expect(res.body.ticket).toHaveLength(43)
    expect(res.body.expiresAt).toBeGreaterThan(Date.now())
  })

  it('requires authentication', async () => {
    const res = await request(app).post('/api/products/events/ticket')
    expect(res.status).toBe(401)
  })

  // The client re-mints this ticket every ~4 minutes for as long as the app is
  // merely open, with no user involvement. If it renewed the session, an
  // unattended terminal would keep itself logged in forever, which is exactly
  // what "an idle session still expires" forbids.
  it('does not renew the session, even with a token past its half-life', async () => {
    const res = await request(app)
      .post('/api/products/events/ticket')
      .set('Authorization', `Bearer ${agedStaffToken}`)

    expect(res.status).toBe(201)
    expect(res.headers['x-renewed-token']).toBeUndefined()
  })

  it('is the only excluded path — a real request renews with the same token', async () => {
    const res = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${agedStaffToken}`)

    expect(res.status).toBe(200)
    expect(typeof res.headers['x-renewed-token']).toBe('string')
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

  it('serves a photo even when PRODUCT_PHOTOS_DIR sits under a dot-prefixed ancestor directory', async () => {
    // Regression test: res.sendFile(filename, { root }) must be called WITH
    // the `root` option. Without it, the underlying `send` package
    // dotfile-checks every segment of the resolved *absolute* path — so any
    // dot-prefixed ancestor (e.g. this repo's own `.claude/worktrees/...`
    // layout) causes a false 404, even though the served file itself isn't a
    // dotfile. A plain os.tmpdir() dir never has a dot-prefixed ancestor, so
    // it can't catch this; we manufacture one here.
    const dotPrefixedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'product-photos-dot-test-'))
    const hiddenDir = path.join(dotPrefixedRoot, '.hidden-test-dir', 'product-photos')
    fs.mkdirSync(hiddenDir, { recursive: true })

    const previousPhotosDir = process.env.PRODUCT_PHOTOS_DIR
    process.env.PRODUCT_PHOTOS_DIR = hiddenDir

    try {
      const filename = 'dead123beef.jpg'
      const contents = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
      fs.writeFileSync(path.join(hiddenDir, filename), contents)

      await prisma.product.update({
        where: { id: productId },
        data: { photos: JSON.stringify([filename]) },
      })

      const response = await request(app)
        .get(`/api/products/${productId}/photos/${filename}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toContain('image/jpeg')
      expect(Buffer.compare(response.body, contents)).toBe(0)
    } finally {
      process.env.PRODUCT_PHOTOS_DIR = previousPhotosDir
      fs.rmSync(dotPrefixedRoot, { recursive: true, force: true })
    }
  })
})
