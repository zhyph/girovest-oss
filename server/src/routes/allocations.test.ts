import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '../db/client.js'
import { signStaffToken } from '../auth/jwt.js'
import { seedTwoLocations } from '../testHelpers/twoLocationFixture.js'

let locationId: string
let staffId: string
let staffToken: string
let clientId: string
let productId: string

// Far enough ahead that "today" is always before it, so every request in this
// file exercises the early-checkout path without depending on the clock.
const FUTURE_CHECKOUT = new Date('2099-01-10T00:00:00.000Z')
const FUTURE_DUE = new Date('2099-01-15T00:00:00.000Z')

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  locationId = location.id
  const staff = await prisma.staff.create({
    data: { name: 'S', login: `staff-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId },
  })
  staffId = staff.id
  staffToken = signStaffToken({ staffId: staff.id, role: 'staff' })
  const client = await prisma.client.create({ data: { name: 'Maria Silva', phone: '1', email: 'm@e.com', locationId } })
  clientId = client.id
  const product = await prisma.product.create({
    data: { locationId, name: 'Vestido', category: 'festa', size: 'M', color: 'azul', rentalPrice: 100, depositAmount: 50 },
  })
  productId = product.id
})

afterEach(async () => {
  await prisma.allocation.deleteMany()
  await prisma.product.deleteMany()
  await prisma.client.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

function seedReservedAllocation(
  dates: { checkoutDate: Date; dueDate: Date } = { checkoutDate: FUTURE_CHECKOUT, dueDate: FUTURE_DUE },
) {
  return prisma.allocation.create({
    data: {
      productId,
      clientId,
      staffId,
      checkoutDate: dates.checkoutDate,
      dueDate: dates.dueDate,
      status: 'reserved',
      priceCharged: 100,
    },
  })
}

describe('POST /api/allocations/:id/check-out', () => {
  it('requires authentication', async () => {
    const allocation = await seedReservedAllocation()

    const response = await request(app).post(`/api/allocations/${allocation.id}/check-out`)

    expect(response.status).toBe(401)
  })

  it('refuses an early check-out when no override was sent', async () => {
    const allocation = await seedReservedAllocation()

    const response = await request(app)
      .post(`/api/allocations/${allocation.id}/check-out`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({})

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('CHECKOUT_TOO_EARLY')
  })

  it('performs the early check-out when the override is confirmed', async () => {
    const allocation = await seedReservedAllocation()

    const response = await request(app)
      .post(`/api/allocations/${allocation.id}/check-out`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ allowEarly: true })

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('checked_out')
    expect(response.body.actualCheckoutDate).not.toBeNull()
    // The contracted date printed on the signed contract stays untouched.
    expect(new Date(response.body.checkoutDate)).toEqual(FUTURE_CHECKOUT)
    // allowEarly is an intent, never a stored column.
    expect(response.body).not.toHaveProperty('allowEarly')
  })

  it('refuses the override when the days it would claim belong to another booking', async () => {
    // Same dress, promised to someone else between now and this pickup date.
    await seedReservedAllocation({
      checkoutDate: new Date('2098-12-01T00:00:00.000Z'),
      dueDate: new Date('2098-12-05T00:00:00.000Z'),
    })
    const allocation = await seedReservedAllocation()

    const response = await request(app)
      .post(`/api/allocations/${allocation.id}/check-out`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ allowEarly: true })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('EARLY_CHECKOUT_CONFLICT')
  })

  it('rejects a non-boolean override', async () => {
    const allocation = await seedReservedAllocation()

    const response = await request(app)
      .post(`/api/allocations/${allocation.id}/check-out`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ allowEarly: 'yes' })

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('VALIDATION_ERROR')
  })
})

// Same-location happy-path coverage. isProductAvailableForRange and
// getProductAvailability both start with (locationId: string, productId:
// string, ...) — the cross-location 404 tests below only prove the route
// rejects a WRONG productId; they can't catch the two leading string
// parameters being transposed in routes/allocations.ts (both requests would
// still 404 in exactly the same way). These 200 assertions on a real,
// known-good product are what would actually break under that regression.
describe('GET /api/allocations/products/:productId/availability', () => {
  it('reports an unallocated product as available, for the date-range query form', async () => {
    const response = await request(app)
      .get(`/api/allocations/products/${productId}/availability`)
      .query({ checkoutDate: '2099-01-10', dueDate: '2099-01-15' })
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ available: true })
  })

  it('reports an unallocated product as available, for the asOf query form', async () => {
    const response = await request(app)
      .get(`/api/allocations/products/${productId}/availability`)
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'available' })
  })
})

// Confirms the routes actually thread req.staff!.locationId through to the
// service layer (allocationService.test.ts covers the service-level guard
// itself in depth) — each case seeds a real Allocation/Product on location
// B and drives it into the status the endpoint's happy path needs, so a
// dropped locationId argument would surface as a mutated row, not just a
// missing 404.
describe('allocations routes cross-location isolation', () => {
  it("404s checking out, returning, or cancelling location B's allocations from location A", async () => {
    const { staffA, staffB, clientB, productB } = await seedTwoLocations()
    const tokenA = signStaffToken({ staffId: staffA.id, role: 'owner' })

    const reservedForCheckOut = await prisma.allocation.create({
      data: {
        productId: productB.id,
        clientId: clientB.id,
        staffId: staffB.id,
        checkoutDate: FUTURE_CHECKOUT,
        dueDate: FUTURE_DUE,
        status: 'reserved',
        priceCharged: 100,
      },
    })
    const checkOutRes = await request(app)
      .post(`/api/allocations/${reservedForCheckOut.id}/check-out`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ allowEarly: true })
    expect(checkOutRes.status).toBe(404)
    expect(checkOutRes.body.code).toBe('NOT_FOUND')
    const untouchedCheckOut = await prisma.allocation.findUniqueOrThrow({ where: { id: reservedForCheckOut.id } })
    expect(untouchedCheckOut.status).toBe('reserved')

    const checkedOut = await prisma.allocation.create({
      data: {
        productId: productB.id,
        clientId: clientB.id,
        staffId: staffB.id,
        checkoutDate: FUTURE_CHECKOUT,
        dueDate: FUTURE_DUE,
        status: 'checked_out',
        actualCheckoutDate: new Date(),
        priceCharged: 100,
      },
    })
    const returnRes = await request(app)
      .post(`/api/allocations/${checkedOut.id}/return`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
    expect(returnRes.status).toBe(404)
    expect(returnRes.body.code).toBe('NOT_FOUND')
    const untouchedReturn = await prisma.allocation.findUniqueOrThrow({ where: { id: checkedOut.id } })
    expect(untouchedReturn.status).toBe('checked_out')

    const reservedForCancel = await prisma.allocation.create({
      data: {
        productId: productB.id,
        clientId: clientB.id,
        staffId: staffB.id,
        checkoutDate: FUTURE_CHECKOUT,
        dueDate: FUTURE_DUE,
        status: 'reserved',
        priceCharged: 100,
      },
    })
    const cancelRes = await request(app)
      .post(`/api/allocations/${reservedForCancel.id}/cancel`)
      .set('Authorization', `Bearer ${tokenA}`)
    expect(cancelRes.status).toBe(404)
    expect(cancelRes.body.code).toBe('NOT_FOUND')
    const untouchedCancel = await prisma.allocation.findUniqueOrThrow({ where: { id: reservedForCancel.id } })
    expect(untouchedCancel.status).toBe('reserved')
  })

  it("404s checking a location B product's availability from location A, both with and without a date range", async () => {
    const { staffA, productB } = await seedTwoLocations()
    const tokenA = signStaffToken({ staffId: staffA.id, role: 'owner' })

    const rangeRes = await request(app)
      .get(`/api/allocations/products/${productB.id}/availability`)
      .query({ checkoutDate: '2099-01-10', dueDate: '2099-01-15' })
      .set('Authorization', `Bearer ${tokenA}`)
    expect(rangeRes.status).toBe(404)
    expect(rangeRes.body.code).toBe('NOT_FOUND')

    const statusRes = await request(app)
      .get(`/api/allocations/products/${productB.id}/availability`)
      .set('Authorization', `Bearer ${tokenA}`)
    expect(statusRes.status).toBe(404)
    expect(statusRes.body.code).toBe('NOT_FOUND')
  })

  it("does not include location B's allocations in location A's list", async () => {
    const { staffA, staffB, clientA, clientB, productA, productB } = await seedTwoLocations()
    const tokenA = signStaffToken({ staffId: staffA.id, role: 'owner' })
    const ownAllocation = await prisma.allocation.create({
      data: {
        productId: productA.id,
        clientId: clientA.id,
        staffId: staffA.id,
        checkoutDate: FUTURE_CHECKOUT,
        dueDate: FUTURE_DUE,
        status: 'reserved',
        priceCharged: 100,
      },
    })
    await prisma.allocation.create({
      data: {
        productId: productB.id,
        clientId: clientB.id,
        staffId: staffB.id,
        checkoutDate: FUTURE_CHECKOUT,
        dueDate: FUTURE_DUE,
        status: 'reserved',
        priceCharged: 100,
      },
    })

    const response = await request(app).get('/api/allocations').set('Authorization', `Bearer ${tokenA}`)

    expect(response.status).toBe(200)
    expect(response.body.map((a: { id: string }) => a.id)).toEqual([ownAllocation.id])
  })
})
