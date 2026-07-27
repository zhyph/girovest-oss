import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '../db/client.js'
import { signStaffToken } from '../auth/jwt.js'

let locationId: string
let staffId: string
let staffToken: string
let clientId: string

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
})

afterEach(async () => {
  await prisma.installment.deleteMany()
  await prisma.allocation.deleteMany()
  await prisma.contract.deleteMany()
  await prisma.product.deleteMany()
  await prisma.client.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('GET /api/contracts', () => {
  it('requires authentication', async () => {
    const response = await request(app).get('/api/contracts')
    expect(response.status).toBe(401)
  })

  it('returns a paginated envelope with default page/pageSize', async () => {
    await prisma.contract.create({
      data: { number: 1, locationId, clientId, staffId, eventDate: new Date(), paymentMethod: 'PIX' },
    })

    const response = await request(app).get('/api/contracts').set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ total: 1, page: 1, pageSize: 20 })
    expect(response.body.contracts).toHaveLength(1)
  })

  it('honors page and pageSize query params', async () => {
    for (let i = 0; i < 5; i++) {
      await prisma.contract.create({
        data: { number: i + 1, locationId, clientId, staffId, eventDate: new Date(), paymentMethod: 'PIX' },
      })
    }

    const response = await request(app)
      .get('/api/contracts')
      .query({ page: 2, pageSize: 2 })
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ total: 5, page: 2, pageSize: 2 })
    expect(response.body.contracts).toHaveLength(2)
  })

  it('filters by search query param, case-insensitive', async () => {
    await prisma.contract.create({
      data: { number: 1, locationId, clientId, staffId, eventDate: new Date(), paymentMethod: 'PIX' },
    })

    const match = await request(app)
      .get('/api/contracts')
      .query({ search: 'maria' })
      .set('Authorization', `Bearer ${staffToken}`)
    expect(match.body.contracts).toHaveLength(1)

    const noMatch = await request(app)
      .get('/api/contracts')
      .query({ search: 'nobody' })
      .set('Authorization', `Bearer ${staffToken}`)
    expect(noMatch.body.contracts).toHaveLength(0)
  })

  it('never returns a contract from another location', async () => {
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'B' } })
    const otherClient = await prisma.client.create({ data: { name: 'X', phone: '1', email: 'x@e.com' } })
    const otherStaff = await prisma.staff.create({
      data: { name: 'S2', login: `staff2-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId: otherLocation.id },
    })
    await prisma.contract.create({
      data: { number: 1, locationId: otherLocation.id, clientId: otherClient.id, staffId: otherStaff.id, eventDate: new Date(), paymentMethod: 'PIX' },
    })

    const response = await request(app).get('/api/contracts').set('Authorization', `Bearer ${staffToken}`)

    expect(response.body.total).toBe(0)
    expect(response.body.contracts).toHaveLength(0)
  })
})

describe('POST /api/contracts', () => {
  it('rejects an eventDate that is not a real calendar day instead of silently rolling it over', async () => {
    const product = await prisma.product.create({
      data: {
        locationId, name: 'Vestido', category: 'Festa', size: 'M', color: 'Azul',
        rentalPrice: 100, depositAmount: 50,
      },
    })

    const response = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        clientId,
        eventDate: '2026-02-31',
        paymentMethod: 'PIX',
        items: [{ productId: product.id, checkoutDate: '2026-02-28', dueDate: '2026-03-02', priceCharged: 100 }],
        installments: [],
      })

    expect(response.status).toBe(400)
    const created = await prisma.contract.count()
    expect(created).toBe(0)
  })

  it('rejects an impossible checkoutDate/dueDate on a line item the same way', async () => {
    const product = await prisma.product.create({
      data: {
        locationId, name: 'Vestido', category: 'Festa', size: 'M', color: 'Azul',
        rentalPrice: 100, depositAmount: 50,
      },
    })

    const response = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        clientId,
        eventDate: '2026-10-03',
        paymentMethod: 'PIX',
        items: [{ productId: product.id, checkoutDate: '2026-04-31', dueDate: '2026-10-05', priceCharged: 100 }],
        installments: [],
      })

    expect(response.status).toBe(400)
  })
})

describe('PATCH /api/contracts/:contractId/installments/:installmentId', () => {
  async function createContractWithInstallment() {
    const product = await prisma.product.create({
      data: {
        locationId, name: 'Vestido', category: 'Festa', size: 'M', color: 'Azul',
        rentalPrice: 100, depositAmount: 50,
      },
    })
    const response = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        clientId,
        eventDate: '2026-10-03',
        paymentMethod: 'PIX',
        items: [{ productId: product.id, checkoutDate: '2026-10-02', dueDate: '2026-10-05', priceCharged: 100 }],
        installments: [{ dueDate: '2026-09-20', amount: 100 }],
      })
    return response.body as { id: string; installments: { id: string }[] }
  }

  it('marks an installment as paid', async () => {
    const contract = await createContractWithInstallment()

    const response = await request(app)
      .patch(`/api/contracts/${contract.id}/installments/${contract.installments[0].id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ paid: true })

    expect(response.status).toBe(200)
    expect(response.body.installments[0].paid).toBe(true)
    expect(response.body.installments[0].paidAt).not.toBeNull()
  })

  it('requires authentication', async () => {
    const contract = await createContractWithInstallment()

    const response = await request(app)
      .patch(`/api/contracts/${contract.id}/installments/${contract.installments[0].id}`)
      .send({ paid: true })

    expect(response.status).toBe(401)
  })

  it('rejects a payload without a paid flag', async () => {
    const contract = await createContractWithInstallment()

    const response = await request(app)
      .patch(`/api/contracts/${contract.id}/installments/${contract.installments[0].id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({})

    expect(response.status).toBe(400)
  })

  it('404s for an installment that does not exist', async () => {
    const contract = await createContractWithInstallment()

    const response = await request(app)
      .patch(`/api/contracts/${contract.id}/installments/does-not-exist`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ paid: true })

    expect(response.status).toBe(404)
  })
})
