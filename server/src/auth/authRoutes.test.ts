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
