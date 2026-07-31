import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { app } from '../app.js'
import { prisma } from '../db/client.js'
import { signStaffToken } from '../auth/jwt.js'

let staffToken: string

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  const staff = await prisma.staff.create({
    data: {
      name: 'S',
      login: `staff-${Date.now()}-${Math.random()}`,
      passwordHash: 'x',
      role: 'staff',
      locationId: location.id,
    },
  })
  staffToken = signStaffToken({ staffId: staff.id, role: 'staff' })
})

afterEach(async () => {
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('POST /api/backup/snapshot', () => {
  it('rejects a request with no auth token', async () => {
    await request(app).post('/api/backup/snapshot').expect(401)
  })

  it('writes a valid, openable snapshot of the live database', async () => {
    const response = await request(app)
      .post('/api/backup/snapshot')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200)

    expect(path.isAbsolute(response.body.path)).toBe(true)
    expect(fs.existsSync(response.body.path)).toBe(true)
    const snapshot = new Database(response.body.path, { readonly: true, fileMustExist: true })
    expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok')
    snapshot.close()
  })

  it('is not available when DB_PROVIDER is postgresql', async () => {
    const original = process.env.DB_PROVIDER
    process.env.DB_PROVIDER = 'postgresql'
    try {
      const response = await request(app)
        .post('/api/backup/snapshot')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(404)
      expect(response.body.code).toBe('NOT_FOUND')
    } finally {
      if (original === undefined) delete process.env.DB_PROVIDER
      else process.env.DB_PROVIDER = original
    }
  })
})
