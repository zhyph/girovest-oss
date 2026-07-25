import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { signingApp } from './signingApp.js'
import { prisma } from './db/client.js'
import { issueSigningToken } from './services/signingService.js'
import { issueProductPhotoSession } from './services/productPhotoTokenService.js'

let contractId: string
let productId: string
let locationId: string
let staffId: string
let photosDir: string
let originalPhotosDir: string | undefined

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  locationId = location.id
  const staff = await prisma.staff.create({
    data: { name: 'S', login: `staff-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId },
  })
  staffId = staff.id
  const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@example.com' } })
  const contract = await prisma.contract.create({
    data: { number: 1, locationId, clientId: client.id, staffId: staff.id, eventDate: new Date('2026-10-03'), paymentMethod: 'PIX' },
  })
  contractId = contract.id
  const product = await prisma.product.create({
    data: { locationId, name: 'P', category: 'festa', size: 'M', color: 'azul', rentalPrice: 100, depositAmount: 50 },
  })
  productId = product.id

  // submitPhotos writes real files; keep the new tests' output out of the
  // repo tree the same way productPhotoTokenService.test.ts does.
  photosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-photos-signingapp-test-'))
  originalPhotosDir = process.env.PRODUCT_PHOTOS_DIR
  process.env.PRODUCT_PHOTOS_DIR = photosDir
})

afterEach(async () => {
  process.env.PRODUCT_PHOTOS_DIR = originalPhotosDir
  fs.rmSync(photosDir, { recursive: true, force: true })
  await prisma.signingToken.deleteMany()
  await prisma.productPhotoToken.deleteMany()
  await prisma.contract.deleteMany()
  await prisma.client.deleteMany()
  await prisma.allocation.deleteMany()
  await prisma.product.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('GET /sign/:token', () => {
  it('serves the signing page for a valid token', async () => {
    const { token } = await issueSigningToken(contractId, locationId)

    const response = await request(signingApp).get(`/sign/${token}`)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.text).toContain('<canvas')
  })

  it('serves an invalid-code message for an unknown token, without a canvas', async () => {
    const response = await request(signingApp).get('/sign/unknown-token')

    expect(response.status).toBe(200)
    expect(response.text).not.toContain('<canvas')
  })
})

describe('POST /sign/:token/submit', () => {
  it('accepts a valid signature submission', async () => {
    const { token } = await issueSigningToken(contractId, locationId)

    const response = await request(signingApp)
      .post(`/sign/${token}/submit`)
      .send({ signatureImage: 'data:image/png;base64,abc' })

    expect(response.status).toBe(200)
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } })
    expect(contract.signatureStatus).toBe('signed')
  })

  it('rejects a missing signatureImage with 400', async () => {
    const { token } = await issueSigningToken(contractId, locationId)

    const response = await request(signingApp).post(`/sign/${token}/submit`).send({})

    expect(response.status).toBe(400)
  })

  it('rejects a signatureImage that is not a PNG data URL with 400', async () => {
    const { token } = await issueSigningToken(contractId, locationId)

    const response = await request(signingApp)
      .post(`/sign/${token}/submit`)
      .send({ signatureImage: 'data:image/svg+xml;base64,PHNjcmlwdD4=' })

    expect(response.status).toBe(400)
  })

  it('rejects a submit with an unknown token', async () => {
    const response = await request(signingApp)
      .post('/sign/unknown-token/submit')
      .send({ signatureImage: 'data:image/png;base64,abc' })

    expect(response.status).toBe(404)
  })
})

describe('GET /product-photos/:token', () => {
  it('serves the photo intake page for a valid token', async () => {
    const { token } = await issueProductPhotoSession(staffId, locationId)

    const response = await request(signingApp).get(`/product-photos/${token}`)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    // Expected to fail until Task 5 (server/src/productPhotoPage.ts) provides real phone-page markup
    expect(response.text).toContain('type="file"')
  })

  it('serves an invalid-code message for an unknown token, without a file input', async () => {
    const response = await request(signingApp).get('/product-photos/unknown-token')

    expect(response.status).toBe(200)
    expect(response.text).not.toContain('type="file"')
  })
})

describe('POST /product-photos/:token/submit', () => {
  it('accepts a valid photo submission', async () => {
    const { token } = await issueProductPhotoSession(staffId, locationId)

    const response = await request(signingApp)
      .post(`/product-photos/${token}/submit`)
      .send({ productId, photos: ['data:image/jpeg;base64,abc'] })

    expect(response.status).toBe(200)
  })

  it('rejects a missing photos array with 400', async () => {
    const { token } = await issueProductPhotoSession(staffId, locationId)

    const response = await request(signingApp).post(`/product-photos/${token}/submit`).send({ productId })

    expect(response.status).toBe(400)
  })

  it('rejects a submit with an unknown token', async () => {
    const response = await request(signingApp)
      .post('/product-photos/unknown-token/submit')
      .send({ productId, photos: ['data:image/jpeg;base64,abc'] })

    expect(response.status).toBe(404)
  })
})

describe('exposed surface', () => {
  it('exposes no route other than /sign/:token and /sign/:token/submit', async () => {
    const response = await request(signingApp).get('/api/contracts')
    expect(response.status).toBe(404)
  })
})
