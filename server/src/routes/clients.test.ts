import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '../db/client.js'
import { signStaffToken } from '../auth/jwt.js'
import { seedTwoLocations } from '../testHelpers/twoLocationFixture.js'

afterEach(async () => {
  await prisma.allocation.deleteMany()
  await prisma.contract.deleteMany()
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
    const { staffA, locationA, locationB } = await seedTwoLocations()
    const token = signStaffToken({ staffId: staffA.id, role: 'owner' })

    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        id: 'forged-id',
        locationId: locationB.id,
        name: 'New Client',
        phone: '1',
        email: 'n@example.com',
      })
    expect(res.status).toBe(201)
    expect(res.body.locationId).toBe(locationA.id)
    expect(res.body.locationId).not.toBe(locationB.id)
  })
})

describe('GET /api/clients/:id/contracts', () => {
  it("returns only the given client's own contracts, with allocations", async () => {
    const { staffA, locationA, productA, clientA } = await seedTwoLocations()
    const token = signStaffToken({ staffId: staffA.id, role: 'owner' })

    const contract = await prisma.contract.create({
      data: {
        number: 1,
        locationId: locationA.id,
        clientId: clientA.id,
        staffId: staffA.id,
        eventDate: new Date('2026-01-10'),
        paymentMethod: 'PIX',
      },
    })
    await prisma.allocation.create({
      data: {
        productId: productA.id,
        clientId: clientA.id,
        staffId: staffA.id,
        contractId: contract.id,
        checkoutDate: new Date('2026-01-05'),
        dueDate: new Date('2026-01-08'),
        status: 'reserved',
        priceCharged: 100,
      },
    })

    const res = await request(app)
      .get(`/api/clients/${clientA.id}/contracts`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe(contract.id)
    expect(res.body[0].allocations).toHaveLength(1)
  })

  it("404s when staff at location A requests location B's client contracts", async () => {
    const { staffA, clientB } = await seedTwoLocations()
    const token = signStaffToken({ staffId: staffA.id, role: 'owner' })

    const res = await request(app)
      .get(`/api/clients/${clientB.id}/contracts`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  it('requires authentication', async () => {
    const { clientA } = await seedTwoLocations()
    const res = await request(app).get(`/api/clients/${clientA.id}/contracts`)
    expect(res.status).toBe(401)
  })
})
