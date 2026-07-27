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
    expect(response.text).toContain('type="file"')
  })

  it('serves an invalid-code message for an unknown token, without a file input', async () => {
    const response = await request(signingApp).get('/product-photos/unknown-token')

    expect(response.status).toBe(200)
    expect(response.text).not.toContain('type="file"')
  })

  it('renders a product-picker screen with a search input and product list container', async () => {
    const { token } = await issueProductPhotoSession(staffId, locationId)

    const response = await request(signingApp).get(`/product-photos/${token}`)

    expect(response.text).toContain('id="search-input"')
    expect(response.text).toContain('id="product-list"')
    expect(response.text).toContain('id="picker-screen"')
  })

  it('renders a camera-capture screen with two distinct file inputs: a single-shot camera input and a multi-select gallery input', async () => {
    const { token } = await issueProductPhotoSession(staffId, locationId)

    const response = await request(signingApp).get(`/product-photos/${token}`)

    // Root cause of the original one-photo-only bug: capture="environment" on a mobile
    // browser returns exactly one photo per invocation no matter what else is on that
    // input, so the fix requires two separate inputs rather than tweaking one.
    const cameraInputMatch = response.text.match(/<input[^>]*id="camera-input"[^>]*>/)
    expect(cameraInputMatch).not.toBeNull()
    expect(cameraInputMatch![0]).toContain('capture="environment"')
    expect(cameraInputMatch![0]).not.toContain('multiple')

    const galleryInputMatch = response.text.match(/<input[^>]*id="gallery-input"[^>]*>/)
    expect(galleryInputMatch).not.toBeNull()
    expect(galleryInputMatch![0]).toContain('multiple')
    expect(galleryInputMatch![0]).not.toContain('capture')

    expect(response.text).toContain('id="take-photo"')
    expect(response.text).toContain('id="gallery-link"')
    expect(response.text).toContain('id="back-link"')
  })

  it('embeds the token in the inline script so the picker/capture screens can call the token-scoped API', async () => {
    const { token } = await issueProductPhotoSession(staffId, locationId)

    const response = await request(signingApp).get(`/product-photos/${token}`)

    expect(response.text).toContain(JSON.stringify(token))
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

  it('rejects a productId belonging to a different location than the token', async () => {
    const { token } = await issueProductPhotoSession(staffId, locationId)
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'X' } })
    const otherProduct = await prisma.product.create({
      data: { locationId: otherLocation.id, name: 'X', category: 'x', size: 'x', color: 'x', rentalPrice: 1, depositAmount: 1 },
    })

    const response = await request(signingApp)
      .post(`/product-photos/${token}/submit`)
      .send({ productId: otherProduct.id, photos: ['data:image/jpeg;base64,abc'] })

    expect(response.status).toBe(404)
  })
})

describe('POST /product-photos/:token/products', () => {
  const NEW_PRODUCT = {
    name: 'Vestido Novo',
    category: 'festa',
    size: 'G',
    color: 'vermelho',
    rentalPrice: 250,
    depositAmount: 125,
  }

  it('creates a product and returns it with 201', async () => {
    const { token } = await issueProductPhotoSession(staffId, locationId)

    const response = await request(signingApp).post(`/product-photos/${token}/products`).send(NEW_PRODUCT)

    expect(response.status).toBe(201)
    expect(response.body.id).toEqual(expect.any(String))
    expect(response.body.name).toBe('Vestido Novo')
    expect(response.body.photos).toEqual([])
    expect(response.body.availability).toBe('available')
  })

  it('ignores a locationId in the body and uses the token\'s location', async () => {
    const { token } = await issueProductPhotoSession(staffId, locationId)
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'X' } })

    const response = await request(signingApp)
      .post(`/product-photos/${token}/products`)
      .send({ ...NEW_PRODUCT, locationId: otherLocation.id })

    expect(response.status).toBe(201)
    expect(response.body.locationId).toBe(locationId)
    const row = await prisma.product.findUniqueOrThrow({ where: { id: response.body.id } })
    expect(row.locationId).toBe(locationId)
  })

  it.each(['name', 'category', 'size', 'color', 'rentalPrice', 'depositAmount'])(
    'rejects a payload missing %s with 400',
    async (field) => {
      const { token } = await issueProductPhotoSession(staffId, locationId)
      const payload: Record<string, unknown> = { ...NEW_PRODUCT }
      delete payload[field]

      const response = await request(signingApp).post(`/product-photos/${token}/products`).send(payload)

      expect(response.status).toBe(400)
    },
  )

  it('rejects a negative rentalPrice with 400', async () => {
    const { token } = await issueProductPhotoSession(staffId, locationId)

    const response = await request(signingApp)
      .post(`/product-photos/${token}/products`)
      .send({ ...NEW_PRODUCT, rentalPrice: -1 })

    expect(response.status).toBe(400)
  })

  it('rejects an over-long name with 400', async () => {
    const { token } = await issueProductPhotoSession(staffId, locationId)

    const response = await request(signingApp)
      .post(`/product-photos/${token}/products`)
      .send({ ...NEW_PRODUCT, name: 'a'.repeat(201) })

    expect(response.status).toBe(400)
  })

  it('rejects an unknown token with 404', async () => {
    const response = await request(signingApp).post('/product-photos/unknown-token/products').send(NEW_PRODUCT)

    expect(response.status).toBe(404)
    expect(await prisma.product.count({ where: { name: NEW_PRODUCT.name } })).toBe(0)
  })

  // 410 rather than the sibling GET's 404: this matches POST .../submit, the
  // other write path, so the phone can tell "your code expired, ask for a new
  // one" apart from "that never existed".
  it('rejects an expired token with 410', async () => {
    const { token } = await issueProductPhotoSession(staffId, locationId)
    await prisma.productPhotoToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } })

    const response = await request(signingApp).post(`/product-photos/${token}/products`).send(NEW_PRODUCT)

    expect(response.status).toBe(410)
    expect(await prisma.product.count({ where: { name: NEW_PRODUCT.name } })).toBe(0)
  })

  it('makes the created product immediately visible to the picker listing', async () => {
    const { token } = await issueProductPhotoSession(staffId, locationId)

    const created = await request(signingApp).post(`/product-photos/${token}/products`).send(NEW_PRODUCT)
    const listed = await request(signingApp).get(`/product-photos/${token}/products`)

    expect(listed.body.map((p: { id: string }) => p.id)).toContain(created.body.id)
  })
})

describe('GET /product-photos/:token/products', () => {
  it('returns the token\'s location\'s products, most recent first', async () => {
    const secondProduct = await prisma.product.create({
      data: { locationId, name: 'Second', category: 'festa', size: 'M', color: 'azul', rentalPrice: 1, depositAmount: 1 },
    })
    const { token } = await issueProductPhotoSession(staffId, locationId)

    const response = await request(signingApp).get(`/product-photos/${token}/products`)

    expect(response.status).toBe(200)
    expect(response.body.map((p: { id: string }) => p.id)).toEqual([secondProduct.id, productId])
  })

  it('supports a ?search= query param', async () => {
    await prisma.product.create({
      data: { locationId, name: 'Vestido Verde', category: 'gala', size: 'M', color: 'verde', rentalPrice: 1, depositAmount: 1 },
    })
    const { token } = await issueProductPhotoSession(staffId, locationId)

    const response = await request(signingApp).get(`/product-photos/${token}/products?search=verde`)

    expect(response.status).toBe(200)
    expect(response.body.map((p: { name: string }) => p.name)).toEqual(['Vestido Verde'])
  })

  it('returns 404 for an unknown or expired token', async () => {
    const response = await request(signingApp).get('/product-photos/unknown-token/products')
    expect(response.status).toBe(404)
  })

  it('never returns a product from a different location', async () => {
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'X' } })
    const otherProduct = await prisma.product.create({
      data: { locationId: otherLocation.id, name: 'Other Product', category: 'x', size: 'x', color: 'x', rentalPrice: 1, depositAmount: 1 },
    })
    const { token } = await issueProductPhotoSession(staffId, locationId)

    const response = await request(signingApp).get(`/product-photos/${token}/products`)

    expect(response.body.map((p: { id: string }) => p.id)).not.toContain(otherProduct.id)
  })
})

describe('exposed surface', () => {
  it('exposes no route other than /sign/:token and /sign/:token/submit', async () => {
    const response = await request(signingApp).get('/api/contracts')
    expect(response.status).toBe(404)
  })
})
