import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { app } from '../app.js'
import { prisma } from '../db/client.js'
import { SESSION_TTL_SECONDS, signStaffToken, verifyStaffToken } from './jwt.js'

// jsonwebtoken honours a caller-supplied `iat` and derives `exp` from it, so we
// can mint a token that is genuinely N hours old without touching timers.
function signAgedToken(staffId: string, ageSeconds: number): string {
  const iat = Math.floor(Date.now() / 1000) - ageSeconds
  return jwt.sign({ staffId, role: 'staff', iat }, process.env.JWT_SECRET as string, {
    expiresIn: SESSION_TTL_SECONDS,
  })
}

describe('sliding session renewal', () => {
  let locationId: string
  let staffId: string

  beforeAll(async () => {
    const location = await prisma.location.create({
      data: { name: 'Loja Renovação', address: 'Rua Teste, 3' },
    })
    locationId = location.id

    const staff = await prisma.staff.create({
      data: {
        name: 'Carla Staff',
        login: `carla-${Date.now()}`,
        passwordHash: 'x',
        role: 'staff',
        locationId,
      },
    })
    staffId = staff.id
  })

  afterAll(async () => {
    await prisma.staff.deleteMany({ where: { locationId } })
    await prisma.location.delete({ where: { id: locationId } })
  })

  it('does not renew a freshly minted token', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${signStaffToken({ staffId, role: 'staff' })}`)

    expect(response.status).toBe(200)
    expect(response.headers['x-renewed-token']).toBeUndefined()
  })

  it('renews a token that is past its half-life', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${signAgedToken(staffId, 7 * 60 * 60)}`)

    expect(response.status).toBe(200)
    const renewed = response.headers['x-renewed-token']
    expect(typeof renewed).toBe('string')

    const payload = verifyStaffToken(renewed)
    expect(payload.staffId).toBe(staffId)
    expect(payload.role).toBe('staff')
    expect(payload.exp - payload.iat).toBe(SESSION_TTL_SECONDS)
  })

  it('accepts the renewed token on a subsequent request, without renewing it again', async () => {
    const first = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${signAgedToken(staffId, 7 * 60 * 60)}`)

    const second = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${first.headers['x-renewed-token']}`)

    expect(second.status).toBe(200)
    expect(second.body.id).toBe(staffId)
    expect(second.headers['x-renewed-token']).toBeUndefined()
  })

  it('still rejects a genuinely expired token', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${signAgedToken(staffId, 13 * 60 * 60)}`)

    expect(response.status).toBe(401)
    expect(response.body.code).toBe('UNAUTHORIZED')
  })
})
