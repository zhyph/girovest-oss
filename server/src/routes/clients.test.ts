import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '../db/client.js'
import { signStaffToken } from '../auth/jwt.js'
import { seedTwoLocations } from '../testHelpers/twoLocationFixture.js'

afterEach(async () => {
  await prisma.allocation.deleteMany()
  await prisma.client.deleteMany()
  await prisma.product.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('GET/PATCH/DELETE /api/clients/:id cross-location isolation', () => {
  it("404s when staff at location A requests location B's client", async () => {
    const { staffA, clientB } = await seedTwoLocations()
    const token = signStaffToken({ staffId: staffA.id, role: 'owner' })

    const getRes = await request(app).get(`/api/clients/${clientB.id}`).set('Authorization', `Bearer ${token}`)
    expect(getRes.status).toBe(404)

    const patchRes = await request(app)
      .patch(`/api/clients/${clientB.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '999' })
    expect(patchRes.status).toBe(404)

    const deleteRes = await request(app).delete(`/api/clients/${clientB.id}`).set('Authorization', `Bearer ${token}`)
    expect(deleteRes.status).toBe(404)
  })

  it("does not include location B's clients in location A's list", async () => {
    const { staffA, clientA } = await seedTwoLocations()
    const token = signStaffToken({ staffId: staffA.id, role: 'owner' })

    const res = await request(app).get('/api/clients').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.map((c: { id: string }) => c.id)).toEqual([clientA.id])
  })

  it("a created client is assigned to the creating staff's location, not a client-supplied one", async () => {
    const { staffA, locationA } = await seedTwoLocations()
    const token = signStaffToken({ staffId: staffA.id, role: 'owner' })

    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Client', phone: '1', email: 'n@example.com' })
    expect(res.status).toBe(201)
    expect(res.body.locationId).toBe(locationA.id)
  })
})
