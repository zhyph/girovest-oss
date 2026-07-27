import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '../db/client.js'
import { signStaffToken } from '../auth/jwt.js'

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
  const client = await prisma.client.create({ data: { name: 'Maria Silva', phone: '1', email: 'm@e.com' } })
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

function seedReservedAllocation() {
  return prisma.allocation.create({
    data: {
      productId,
      clientId,
      staffId,
      checkoutDate: FUTURE_CHECKOUT,
      dueDate: FUTURE_DUE,
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
