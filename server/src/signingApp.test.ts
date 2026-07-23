import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { signingApp } from './signingApp.js'
import { prisma } from './db/client.js'
import { issueSigningToken } from './services/signingService.js'

let contractId: string

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  const staff = await prisma.staff.create({
    data: { name: 'S', login: `staff-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId: location.id },
  })
  const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@example.com' } })
  const contract = await prisma.contract.create({
    data: { number: 1, locationId: location.id, clientId: client.id, staffId: staff.id, eventDate: new Date('2026-10-03'), paymentMethod: 'PIX' },
  })
  contractId = contract.id
})

afterEach(async () => {
  await prisma.signingToken.deleteMany()
  await prisma.contract.deleteMany()
  await prisma.client.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('GET /sign/:token', () => {
  it('serves the signing page for a valid token', async () => {
    const { token } = await issueSigningToken(contractId)

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
    const { token } = await issueSigningToken(contractId)

    const response = await request(signingApp)
      .post(`/sign/${token}/submit`)
      .send({ signatureImage: 'data:image/png;base64,abc' })

    expect(response.status).toBe(200)
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } })
    expect(contract.signatureStatus).toBe('signed')
  })

  it('rejects a missing signatureImage with 400', async () => {
    const { token } = await issueSigningToken(contractId)

    const response = await request(signingApp).post(`/sign/${token}/submit`).send({})

    expect(response.status).toBe(400)
  })

  it('rejects a submit with an unknown token', async () => {
    const response = await request(signingApp)
      .post('/sign/unknown-token/submit')
      .send({ signatureImage: 'data:image/png;base64,abc' })

    expect(response.status).toBe(404)
  })
})

describe('exposed surface', () => {
  it('exposes no route other than /sign/:token and /sign/:token/submit', async () => {
    const response = await request(signingApp).get('/api/contracts')
    expect(response.status).toBe(404)
  })
})
