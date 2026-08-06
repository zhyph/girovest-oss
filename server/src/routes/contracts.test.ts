import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '../db/client.js'
import { signStaffToken } from '../auth/jwt.js'

// Real openRelayConnection() opens an actual outbound WebSocket to
// credentials.url, which in relay-mode tests below is a fake host —
// stubbed so the route test never makes a real network connection.
const relayConnectionStub = { close: vi.fn(), opened: Promise.resolve(true) }
vi.mock('../network/relayClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../network/relayClient.js')>()
  return { ...actual, openRelayConnection: vi.fn(() => relayConnectionStub) }
})

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
  const client = await prisma.client.create({ data: { name: 'Maria Silva', phone: '1', email: 'm@e.com', locationId } })
  clientId = client.id
})

const RELAY_ENV_KEYS = ['GIROVEST_UPDATE_URL', 'GIROVEST_UPDATE_KEY', 'GIROVEST_INSTALL_ID'] as const

afterEach(async () => {
  await prisma.payment.deleteMany()
  await prisma.allocation.deleteMany()
  await prisma.contract.deleteMany()
  await prisma.product.deleteMany()
  await prisma.client.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
  for (const key of RELAY_ENV_KEYS) delete process.env[key]
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
    const otherClient = await prisma.client.create({ data: { name: 'X', phone: '1', email: 'x@e.com', locationId: otherLocation.id } })
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
      })

    expect(response.status).toBe(400)
  })
})

describe('POST /api/contracts/:contractId/payments', () => {
  async function createBareContractViaApi() {
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
      })
    return response.body as { id: string; payments: { id: string }[] }
  }

  it('logs a payment', async () => {
    const contract = await createBareContractViaApi()

    const response = await request(app)
      .post(`/api/contracts/${contract.id}/payments`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: 100, method: 'PIX', paidAt: '2026-09-20' })

    expect(response.status).toBe(201)
    expect(response.body.payments).toHaveLength(1)
    expect(response.body.payments[0]).toMatchObject({ amount: 100, method: 'PIX' })
  })

  it('requires authentication', async () => {
    const contract = await createBareContractViaApi()

    const response = await request(app)
      .post(`/api/contracts/${contract.id}/payments`)
      .send({ amount: 100, method: 'PIX', paidAt: '2026-09-20' })

    expect(response.status).toBe(401)
  })

  it('rejects a non-positive amount', async () => {
    const contract = await createBareContractViaApi()

    const response = await request(app)
      .post(`/api/contracts/${contract.id}/payments`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: 0, method: 'PIX', paidAt: '2026-09-20' })

    expect(response.status).toBe(400)
  })

  it('404s for a contract that does not exist', async () => {
    const response = await request(app)
      .post('/api/contracts/does-not-exist/payments')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: 100, method: 'PIX', paidAt: '2026-09-20' })

    expect(response.status).toBe(404)
  })
})

describe('PATCH and DELETE /api/contracts/:contractId/payments/:paymentId', () => {
  async function createContractWithPayment() {
    const product = await prisma.product.create({
      data: {
        locationId, name: 'Vestido', category: 'Festa', size: 'M', color: 'Azul',
        rentalPrice: 100, depositAmount: 50,
      },
    })
    const created = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        clientId,
        eventDate: '2026-10-03',
        paymentMethod: 'PIX',
        items: [{ productId: product.id, checkoutDate: '2026-10-02', dueDate: '2026-10-05', priceCharged: 100 }],
      })
    const withPayment = await request(app)
      .post(`/api/contracts/${created.body.id}/payments`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: 100, method: 'PIX', paidAt: '2026-09-20' })
    return withPayment.body as { id: string; payments: { id: string }[] }
  }

  it('corrects a logged payment', async () => {
    const contract = await createContractWithPayment()

    const response = await request(app)
      .patch(`/api/contracts/${contract.id}/payments/${contract.payments[0].id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: 120 })

    expect(response.status).toBe(200)
    expect(response.body.payments[0].amount).toBe(120)
  })

  it('removes a logged payment', async () => {
    const contract = await createContractWithPayment()

    const response = await request(app)
      .delete(`/api/contracts/${contract.id}/payments/${contract.payments[0].id}`)
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.body.payments).toEqual([])
  })

  it('requires authentication', async () => {
    const contract = await createContractWithPayment()

    const patchResponse = await request(app)
      .patch(`/api/contracts/${contract.id}/payments/${contract.payments[0].id}`)
      .send({ amount: 120 })
    expect(patchResponse.status).toBe(401)

    const deleteResponse = await request(app).delete(`/api/contracts/${contract.id}/payments/${contract.payments[0].id}`)
    expect(deleteResponse.status).toBe(401)
  })

  it('404s for a payment that does not exist', async () => {
    const contract = await createContractWithPayment()

    const response = await request(app)
      .patch(`/api/contracts/${contract.id}/payments/does-not-exist`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: 120 })

    expect(response.status).toBe(404)
  })
})

describe('POST /api/contracts/:id/sign-token', () => {
  async function createBareContract() {
    return prisma.contract.create({
      data: { number: 1, locationId, clientId, staffId, eventDate: new Date(), paymentMethod: 'PIX' },
    })
  }

  it('returns LAN-mode candidates/port when connectivityMode is lan (default)', async () => {
    const contract = await createBareContract()

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/sign-token`)
      .set('Authorization', `Bearer ${staffToken}`)

    expect(res.status).toBe(201)
    expect(res.body.mode).toBe('lan')
    expect(res.body.token).toBeTruthy()
    expect(res.body.candidates).toBeDefined()
    expect(res.body.relayUrl).toBeUndefined()
  })

  it('returns a relayUrl instead of LAN candidates when connectivityMode is relay', async () => {
    const contract = await createBareContract()
    await prisma.location.update({ where: { id: locationId }, data: { connectivityMode: 'relay' } })
    process.env.GIROVEST_UPDATE_URL = 'https://girovest-update-proxy.workers.dev'
    process.env.GIROVEST_UPDATE_KEY = 'test-key'
    process.env.GIROVEST_INSTALL_ID = 'test-install'

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/sign-token`)
      .set('Authorization', `Bearer ${staffToken}`)

    expect(res.status).toBe(201)
    expect(res.body.mode).toBe('relay')
    expect(res.body.relayUrl).toBe(`https://girovest-update-proxy.workers.dev/relay/${res.body.token}/sign`)
    expect(res.body.relayUnavailable).toBeUndefined()
    expect(res.body.candidates).toBeUndefined()
    expect(res.body.port).toBeUndefined()
  })

  // The route used to answer 201-with-a-QR before the handshake had even been
  // attempted, so a wrong product key or no internet at all was invisible on
  // the desktop — the only symptom was the phone getting a 504 ten seconds
  // after scanning.
  it('reports relayUnavailable (and closes the socket) when the relay never connects', async () => {
    const contract = await createBareContract()
    await prisma.location.update({ where: { id: locationId }, data: { connectivityMode: 'relay' } })
    process.env.GIROVEST_UPDATE_URL = 'https://girovest-update-proxy.workers.dev'
    process.env.GIROVEST_UPDATE_KEY = 'test-key'
    process.env.GIROVEST_INSTALL_ID = 'test-install'
    const { openRelayConnection } = await import('../network/relayClient.js')
    const close = vi.fn()
    ;(openRelayConnection as ReturnType<typeof vi.fn>).mockReturnValueOnce({ close, opened: Promise.resolve(false) })

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/sign-token`)
      .set('Authorization', `Bearer ${staffToken}`)

    expect(res.status).toBe(201)
    expect(res.body.mode).toBe('relay')
    expect(res.body.relayUnavailable).toBe(true)
    expect(res.body.relayUrl).toBeUndefined()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('falls back to LAN mode when connectivityMode is relay but credentials are not configured', async () => {
    const contract = await createBareContract()
    await prisma.location.update({ where: { id: locationId }, data: { connectivityMode: 'relay' } })

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/sign-token`)
      .set('Authorization', `Bearer ${staffToken}`)

    expect(res.status).toBe(201)
    expect(res.body.mode).toBe('lan')
    expect(res.body.relayUrl).toBeUndefined()
  })
})

describe('GET /api/contracts/outstanding', () => {
  it('answers with the running total', async () => {
    const response = await request(app).get('/api/contracts/outstanding').set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ total: expect.any(Number), count: expect.any(Number) })
  })

  it('requires authentication', async () => {
    const response = await request(app).get('/api/contracts/outstanding')
    expect(response.status).toBe(401)
  })
})
