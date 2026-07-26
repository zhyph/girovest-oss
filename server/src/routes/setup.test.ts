import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '../db/client.js'

describe('GET /api/setup/status', () => {
  beforeAll(async () => {
    // Defensive cleanup: this suite's "empty DB" assertion must hold
    // regardless of what other test files left behind, since Vitest runs
    // files sequentially (parallelism disabled) but doesn't reset the DB
    // between them.
    await prisma.staff.deleteMany()
    await prisma.location.deleteMany()
  })

  it('reports needsSetup: true when no location exists', async () => {
    const response = await request(app).get('/api/setup/status')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ needsSetup: true })
  })
})

describe('GET /api/setup/status with an existing location', () => {
  let locationId: string

  beforeAll(async () => {
    const location = await prisma.location.create({
      data: { name: 'Loja Existente', address: 'Rua X, 1' },
    })
    locationId = location.id
  })

  afterAll(async () => {
    await prisma.location.delete({ where: { id: locationId } })
  })

  it('reports needsSetup: false', async () => {
    const response = await request(app).get('/api/setup/status')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ needsSetup: false })
  })
})

describe('POST /api/setup', () => {
  beforeAll(async () => {
    await prisma.staff.deleteMany()
    await prisma.location.deleteMany()
  })

  afterAll(async () => {
    await prisma.staff.deleteMany()
    await prisma.location.deleteMany()
  })

  it('creates the first location and owner staff row', async () => {
    const response = await request(app).post('/api/setup').send({
      shopName: 'Loja Nova',
      shopAddress: 'Rua Nova, 100',
      ownerName: 'Dona Ana',
      ownerLogin: 'dona-ana',
      ownerPassword: 'fake-password-1234',
    })

    expect(response.status).toBe(201)
    expect(typeof response.body.locationId).toBe('string')
    expect(typeof response.body.staffId).toBe('string')

    const staff = await prisma.staff.findUnique({ where: { id: response.body.staffId } })
    expect(staff).toMatchObject({ login: 'dona-ana', role: 'owner' })
  })

  it('rejects a second call once a location exists', async () => {
    await request(app).post('/api/setup').send({
      shopName: 'Loja Nova',
      shopAddress: 'Rua Nova, 100',
      ownerName: 'Dona Ana',
      ownerLogin: 'dona-ana-2',
      ownerPassword: 'fake-password-1234',
    })

    const response = await request(app).post('/api/setup').send({
      shopName: 'Outra Loja',
      shopAddress: 'Rua Outra, 1',
      ownerName: 'Outra Dona',
      ownerLogin: 'outra-dona',
      ownerPassword: 'fake-password-1234',
    })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('SETUP_ALREADY_COMPLETE')
  })

  it('rejects an incomplete payload with VALIDATION_ERROR', async () => {
    const response = await request(app).post('/api/setup').send({ shopName: 'Loja' })
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('VALIDATION_ERROR')
  })
})
