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

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  locationId = location.id
  const staff = await prisma.staff.create({
    data: { name: 'S', login: `staff-cal-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId },
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

function seedReservedAllocation(dates: { checkoutDate: Date; dueDate: Date }, pId = productId, cId = clientId, sId = staffId) {
  return prisma.allocation.create({
    data: {
      productId: pId,
      clientId: cId,
      staffId: sId,
      checkoutDate: dates.checkoutDate,
      dueDate: dates.dueDate,
      status: 'reserved',
      priceCharged: 100,
    },
  })
}

describe('GET /api/calendar/going-out', () => {
  it('requires authentication', async () => {
    const response = await request(app).get('/api/calendar/going-out').query({ from: '2026-09-01', to: '2026-09-30' })

    expect(response.status).toBe(401)
  })

  it('requires from and to query params', async () => {
    const response = await request(app)
      .get('/api/calendar/going-out')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('VALIDATION_ERROR')
  })

  it('lists reserved allocations checking out within the range', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-10'), dueDate: new Date('2026-09-15') })

    const response = await request(app)
      .get('/api/calendar/going-out')
      .query({ from: '2026-09-01', to: '2026-09-30' })
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.body.map((a: { id: string }) => a.id)).toEqual([allocation.id])
  })
})

describe('GET /api/calendar/due-back', () => {
  it('requires authentication', async () => {
    const response = await request(app).get('/api/calendar/due-back').query({ from: '2026-09-01', to: '2026-09-30' })

    expect(response.status).toBe(401)
  })

  it('requires from and to query params', async () => {
    const response = await request(app)
      .get('/api/calendar/due-back')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('VALIDATION_ERROR')
  })
})

describe('GET /api/calendar/overdue', () => {
  it('requires authentication', async () => {
    const response = await request(app).get('/api/calendar/overdue')

    expect(response.status).toBe(401)
  })

  it('lists checked_out allocations past their due date', async () => {
    const allocation = await prisma.allocation.create({
      data: {
        productId, clientId, staffId,
        checkoutDate: new Date('2026-01-01'), dueDate: new Date('2026-01-05'),
        status: 'checked_out', priceCharged: 100,
      },
    })

    const response = await request(app)
      .get('/api/calendar/overdue')
      .query({ asOf: '2026-07-17' })
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.body.map((a: { id: string }) => a.id)).toEqual([allocation.id])
  })
})

// Calendar has no locationId column of its own — each endpoint reaches
// location only through Allocation -> Product, so each case seeds a matching
// allocation on BOTH locations to confirm the route actually threads
// req.staff!.locationId into the service layer, not just that a made-up id
// would 404 (there's nothing to 404 here — these are always-200 list reads).
describe('calendar routes cross-location isolation', () => {
  it("only returns going-out allocations for the caller's own location", async () => {
    const { staffA, staffB, clientA, clientB, productA, productB } = await seedTwoLocations()
    const tokenA = signStaffToken({ staffId: staffA.id, role: 'owner' })
    const allocationA = await seedReservedAllocation(
      { checkoutDate: new Date('2026-09-10'), dueDate: new Date('2026-09-15') },
      productA.id, clientA.id, staffA.id,
    )
    await seedReservedAllocation(
      { checkoutDate: new Date('2026-09-10'), dueDate: new Date('2026-09-15') },
      productB.id, clientB.id, staffB.id,
    )

    const response = await request(app)
      .get('/api/calendar/going-out')
      .query({ from: '2026-09-01', to: '2026-09-30' })
      .set('Authorization', `Bearer ${tokenA}`)

    expect(response.status).toBe(200)
    expect(response.body.map((a: { id: string }) => a.id)).toEqual([allocationA.id])
  })

  it("only returns due-back allocations for the caller's own location", async () => {
    const { staffA, staffB, clientA, clientB, productA, productB } = await seedTwoLocations()
    const tokenA = signStaffToken({ staffId: staffA.id, role: 'owner' })
    const allocationA = await prisma.allocation.create({
      data: {
        productId: productA.id, clientId: clientA.id, staffId: staffA.id,
        checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-10'),
        status: 'checked_out', priceCharged: 100,
      },
    })
    await prisma.allocation.create({
      data: {
        productId: productB.id, clientId: clientB.id, staffId: staffB.id,
        checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-10'),
        status: 'checked_out', priceCharged: 100,
      },
    })

    const response = await request(app)
      .get('/api/calendar/due-back')
      .query({ from: '2026-09-05', to: '2026-09-15' })
      .set('Authorization', `Bearer ${tokenA}`)

    expect(response.status).toBe(200)
    expect(response.body.map((a: { id: string }) => a.id)).toEqual([allocationA.id])
  })

  it("only returns overdue allocations for the caller's own location", async () => {
    const { staffA, staffB, clientA, clientB, productA, productB } = await seedTwoLocations()
    const tokenA = signStaffToken({ staffId: staffA.id, role: 'owner' })
    const allocationA = await prisma.allocation.create({
      data: {
        productId: productA.id, clientId: clientA.id, staffId: staffA.id,
        checkoutDate: new Date('2026-01-01'), dueDate: new Date('2026-01-05'),
        status: 'checked_out', priceCharged: 100,
      },
    })
    await prisma.allocation.create({
      data: {
        productId: productB.id, clientId: clientB.id, staffId: staffB.id,
        checkoutDate: new Date('2026-01-01'), dueDate: new Date('2026-01-05'),
        status: 'checked_out', priceCharged: 100,
      },
    })

    const response = await request(app)
      .get('/api/calendar/overdue')
      .query({ asOf: '2026-07-17' })
      .set('Authorization', `Bearer ${tokenA}`)

    expect(response.status).toBe(200)
    expect(response.body.map((a: { id: string }) => a.id)).toEqual([allocationA.id])
  })
})
