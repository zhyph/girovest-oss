import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '../db/client.js'
import { hashPassword } from './passwords.js'

describe('POST /api/auth/login', () => {
  let locationId: string

  beforeAll(async () => {
    const location = await prisma.location.create({
      data: { name: 'Loja Teste', address: 'Rua Teste, 1' },
    })
    locationId = location.id

    await prisma.staff.create({
      data: {
        name: 'Ana Owner',
        login: 'ana',
        passwordHash: await hashPassword('correct-horse'),
        role: 'owner',
        locationId,
      },
    })
  })

  afterAll(async () => {
    await prisma.staff.deleteMany({ where: { locationId } })
    await prisma.location.delete({ where: { id: locationId } })
  })

  it('returns a token for correct credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ login: 'ana', password: 'correct-horse' })

    expect(response.status).toBe(200)
    expect(typeof response.body.token).toBe('string')
  })

  it('rejects an incorrect password with INVALID_CREDENTIALS', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ login: 'ana', password: 'wrong-password' })

    expect(response.status).toBe(401)
    expect(response.body.code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects an unknown login with INVALID_CREDENTIALS (not a different error)', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ login: 'nobody', password: 'whatever' })

    expect(response.status).toBe(401)
    expect(response.body.code).toBe('INVALID_CREDENTIALS')
  })
})

describe('GET /api/auth/me', () => {
  let locationId: string

  beforeAll(async () => {
    const location = await prisma.location.create({
      data: { name: 'Loja Teste Me', address: 'Rua Teste, 2' },
    })
    locationId = location.id

    await prisma.staff.create({
      data: {
        name: 'Bruno Staff',
        login: 'bruno',
        passwordHash: await hashPassword('correct-horse'),
        role: 'staff',
        locationId,
      },
    })
  })

  afterAll(async () => {
    await prisma.staff.deleteMany({ where: { locationId } })
    await prisma.location.delete({ where: { id: locationId } })
  })

  it('returns the logged-in staff name, role, and location', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ login: 'bruno', password: 'correct-horse' })

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ name: 'Bruno Staff', role: 'staff', locationId })
  })

  it('returns the location locale, defaulting to pt-BR', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ login: 'bruno', password: 'correct-horse' })

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`)

    expect(response.body.locale).toBe('pt-BR')
  })

  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/auth/me')
    expect(response.status).toBe(401)
  })
})

describe('CORS', () => {
  it('allows cross-origin requests', async () => {
    const response = await request(app).get('/health')
    expect(response.headers['access-control-allow-origin']).toBe('*')
  })
})
