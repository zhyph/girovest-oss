import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/db/client.js'
import { hashPassword } from '../../src/auth/passwords.js'

describe('happy path: register client -> register dress -> allocate -> check out -> return', () => {
  let locationId: string
  let token: string

  beforeAll(async () => {
    const location = await prisma.location.create({ data: { name: 'Loja Feliz', address: 'Av. Principal, 500' } })
    locationId = location.id
    await prisma.staff.create({
      data: {
        name: 'Bia',
        login: 'bia',
        passwordHash: await hashPassword('senha123'),
        role: 'owner',
        locationId,
      },
    })

    const loginResponse = await request(app).post('/api/auth/login').send({ login: 'bia', password: 'senha123' })
    expect(loginResponse.status).toBe(200)
    token = loginResponse.body.token
  })

  afterAll(async () => {
    await prisma.allocation.deleteMany()
    await prisma.product.deleteMany()
    await prisma.client.deleteMany()
    await prisma.staff.deleteMany()
    await prisma.location.deleteMany()
  })

  it('walks the full rental lifecycle', async () => {
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`)

    const clientResponse = await auth(request(app).post('/api/clients')).send({
      name: 'Camila Souza',
      phone: '11988887777',
      email: 'camila@example.com',
    })
    expect(clientResponse.status).toBe(201)
    const clientId = clientResponse.body.id

    const productResponse = await auth(request(app).post('/api/products')).send({
      locationId,
      name: 'Vestido de Festa Dourado',
      category: 'festa',
      size: 'M',
      color: 'dourado',
      rentalPrice: 350,
      depositAmount: 150,
    })
    expect(productResponse.status).toBe(201)
    const productId = productResponse.body.id

    const availabilityBefore = await auth(
      request(app).get(`/api/allocations/products/${productId}/availability?asOf=2026-09-05`),
    )
    expect(availabilityBefore.status).toBe(200)
    expect(availabilityBefore.body.status).toBe('available')

    const allocationResponse = await auth(request(app).post('/api/allocations')).send({
      productId,
      clientId,
      checkoutDate: '2026-09-01',
      dueDate: '2026-09-05',
      priceCharged: 350,
    })
    expect(allocationResponse.status).toBe(201)
    const allocationId = allocationResponse.body.id

    const availabilityReserved = await auth(
      request(app).get(`/api/allocations/products/${productId}/availability?asOf=2026-09-03`),
    )
    expect(availabilityReserved.status).toBe(200)
    expect(availabilityReserved.body.status).toBe('reserved')

    const secondAttempt = await auth(request(app).post('/api/allocations')).send({
      productId,
      clientId,
      checkoutDate: '2026-09-02',
      dueDate: '2026-09-06',
      priceCharged: 350,
    })
    expect(secondAttempt.status).toBe(409)
    expect(secondAttempt.body.code).toBe('PRODUCT_UNAVAILABLE')

    const checkOutResponse = await auth(
      request(app).post(`/api/allocations/${allocationId}/check-out`),
    ).send({ conditionNotesOut: 'Sem manchas', depositCollected: 150 })
    expect(checkOutResponse.status).toBe(200)
    expect(checkOutResponse.body.status).toBe('checked_out')

    const availabilityRented = await auth(
      request(app).get(`/api/allocations/products/${productId}/availability?asOf=2026-09-03`),
    )
    expect(availabilityRented.status).toBe(200)
    expect(availabilityRented.body.status).toBe('rented')

    const returnResponse = await auth(
      request(app).post(`/api/allocations/${allocationId}/return`),
    ).send({ conditionNotesIn: 'Devolvido em bom estado', depositReturned: 150 })
    expect(returnResponse.status).toBe(200)
    expect(returnResponse.body.status).toBe('returned')

    const availabilityAfter = await auth(
      request(app).get(`/api/allocations/products/${productId}/availability?asOf=2026-09-06`),
    )
    expect(availabilityAfter.status).toBe(200)
    expect(availabilityAfter.body.status).toBe('available')
  })
})
