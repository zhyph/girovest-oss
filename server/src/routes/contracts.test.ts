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

  it('CRITICAL: a contract paid to the centavo leaves the worklist and the count', async () => {
    /*
      679,90 + 1.249,90 sums, as floats, to 1929.8000000000001819; the payment
      of exactly 1929,80 is 1929.7999999999999545. `Math.max(0, owed - paid)`
      returned 2.27e-13, which is `> 0`, so this contract stayed in the
      receivables list AND the Painel's "em N contratos em aberto" count
      forever — a worklist that can never be worked off, and a phone call to a
      client who owes nothing. The total looked fine (R$ 0,00); the count did
      not.
    */
    const product = await prisma.product.create({
      data: { locationId, name: 'Vestido Residuo', category: 'festa', size: 'M', color: 'azul', rentalPrice: 679.9, depositAmount: 0 },
    })
    const second = await prisma.product.create({
      data: { locationId, name: 'Vestido Residuo 2', category: 'festa', size: 'G', color: 'rosa', rentalPrice: 1249.9, depositAmount: 0 },
    })
    const created = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        clientId,
        eventDate: '2026-10-03',
        paymentMethod: 'PIX',
        items: [
          { productId: product.id, checkoutDate: '2026-10-01', dueDate: '2026-10-05', priceCharged: 679.9 },
          { productId: second.id, checkoutDate: '2026-10-01', dueDate: '2026-10-05', priceCharged: 1249.9 },
        ],
      })
    expect(created.status).toBe(201)

    const before = await request(app).get('/api/contracts/outstanding').set('Authorization', `Bearer ${staffToken}`)
    expect(before.body.count).toBe(1)

    await request(app)
      .post(`/api/contracts/${created.body.id}/payments`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: 1929.8, method: 'PIX', paidAt: '2026-10-02' })

    const after = await request(app).get('/api/contracts/outstanding').set('Authorization', `Bearer ${staffToken}`)
    expect(after.body.count).toBe(0)
    expect(after.body.total).toBe(0)

    const list = await request(app)
      .get('/api/contracts?status=outstanding')
      .set('Authorization', `Bearer ${staffToken}`)
    expect(list.body.contracts.map((c: { id: string }) => c.id)).not.toContain(created.body.id)
  })

  it('CRITICAL: the same submission twice takes the money once', async () => {
    /*
      The dialog prefills the whole outstanding balance, so a duplicate was the
      DEFAULT outcome of two people acting on one contract — or of one person
      whose first Salvar appeared to hang — not a rare interleaving. There was
      no idempotency, no version check and no cap, so both writes landed and
      the only exits were deleting a payment or refunding money never received.
    */
    const product = await prisma.product.create({
      data: { locationId, name: 'Vestido Idem', category: 'festa', size: 'M', color: 'lilás', rentalPrice: 500, depositAmount: 0 },
    })
    const created = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        clientId,
        eventDate: '2027-01-10',
        paymentMethod: 'PIX',
        items: [{ productId: product.id, checkoutDate: '2027-01-08', dueDate: '2027-01-12', priceCharged: 500 }],
      })

    const body = { amount: 500, method: 'PIX', paidAt: '2027-01-05', clientRequestId: 'dialog-open-abc' }
    const first = await request(app)
      .post(`/api/contracts/${created.body.id}/payments`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send(body)
    const second = await request(app)
      .post(`/api/contracts/${created.body.id}/payments`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send(body)

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(await prisma.payment.count({ where: { contractId: created.body.id } })).toBe(1)
    // And the contract is settled once, not overpaid.
    expect(second.body.payments).toHaveLength(1)
  })

  it('CRITICAL: refuses a request id that belongs to another contract, rather than silently dropping the payment', async () => {
    /*
      The id is unique GLOBALLY, so a hit did not by itself mean "this
      contract's payment already landed" — the server returned the requested
      contract unchanged with a 201, having written nothing. Money the shop
      took, never recorded, nothing on screen to say so.
    */
    const make = async (name: string) => {
      const product = await prisma.product.create({
        data: { locationId, name, category: 'festa', size: 'M', color: 'azul', rentalPrice: 300, depositAmount: 0 },
      })
      const created = await request(app)
        .post('/api/contracts')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          clientId,
          eventDate: '2027-04-10',
          paymentMethod: 'PIX',
          items: [{ productId: product.id, checkoutDate: '2027-04-08', dueDate: '2027-04-12', priceCharged: 300 }],
        })
      return created.body.id as string
    }
    const [a, b] = [await make('Peça A'), await make('Peça B')]
    const body = { amount: 300, method: 'PIX', paidAt: '2027-04-05', clientRequestId: 'shared-id' }

    await request(app).post(`/api/contracts/${a}/payments`).set('Authorization', `Bearer ${staffToken}`).send(body)
    const reused = await request(app)
      .post(`/api/contracts/${b}/payments`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send(body)

    expect(reused.status).toBe(400)
    expect(await prisma.payment.count({ where: { contractId: b } })).toBe(0)
  })

  it('refuses the same id resent with a different amount, rather than discarding the correction', async () => {
    // The id is minted per dialog OPEN and the dialog stays open when a save
    // fails visibly — so a first Salvar that failed after the server committed
    // left her correcting the amount under the same id.
    const product = await prisma.product.create({
      data: { locationId, name: 'Peça Correção', category: 'festa', size: 'M', color: 'azul', rentalPrice: 300, depositAmount: 0 },
    })
    const created = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        clientId,
        eventDate: '2027-05-10',
        paymentMethod: 'PIX',
        items: [{ productId: product.id, checkoutDate: '2027-05-08', dueDate: '2027-05-12', priceCharged: 300 }],
      })
    const send = (amount: number) =>
      request(app)
        .post(`/api/contracts/${created.body.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ amount, method: 'PIX', paidAt: '2027-05-05', clientRequestId: 'same-dialog' })

    await send(100)
    const corrected = await send(55)

    expect(corrected.status).toBe(409)
    const stored = await prisma.payment.findFirst({ where: { contractId: created.body.id } })
    expect(stored?.amount).toBe(100)
  })

  it('orders same-day payments deterministically, by when they were recorded', async () => {
    // A deposit and the balance on the same date is the normal case, and on
    // Postgres a row corrected via updatePayment jumped to the bottom of the
    // table on the sheet the client signs.
    const product = await prisma.product.create({
      data: { locationId, name: 'Peça Mesmo Dia', category: 'festa', size: 'M', color: 'azul', rentalPrice: 300, depositAmount: 0 },
    })
    const created = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        clientId,
        eventDate: '2027-06-10',
        paymentMethod: 'PIX',
        items: [{ productId: product.id, checkoutDate: '2027-06-08', dueDate: '2027-06-12', priceCharged: 300 }],
      })
    for (const amount of [10, 20, 30]) {
      await request(app)
        .post(`/api/contracts/${created.body.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ amount, method: 'PIX', paidAt: '2027-06-01' })
    }
    const first = await prisma.payment.findFirst({ where: { contractId: created.body.id }, orderBy: { createdAt: 'asc' } })
    await request(app)
      .patch(`/api/contracts/${created.body.id}/payments/${first!.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: 11 })

    const detail = await request(app)
      .get(`/api/contracts/${created.body.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
    expect(detail.body.payments.map((p: { amount: number }) => p.amount)).toEqual([11, 20, 30])
  })

  it('records who took the payment', async () => {
    // Cash moved with nobody's name on it: the ledger recorded what and when,
    // never who.
    const product = await prisma.product.create({
      data: { locationId, name: 'Vestido Autor', category: 'festa', size: 'M', color: 'creme', rentalPrice: 200, depositAmount: 0 },
    })
    const created = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        clientId,
        eventDate: '2027-02-10',
        paymentMethod: 'PIX',
        items: [{ productId: product.id, checkoutDate: '2027-02-08', dueDate: '2027-02-12', priceCharged: 200 }],
      })
    await request(app)
      .post(`/api/contracts/${created.body.id}/payments`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: 200, method: 'PIX', paidAt: '2027-02-05' })

    const stored = await prisma.payment.findFirst({ where: { contractId: created.body.id } })
    expect(stored?.recordedByStaffId).toBe(staffId)
  })

  it('returns payments in date order, not insertion order', async () => {
    // paidAt is freely backdatable: log today's, then remember a cash one from
    // last month, and the panel — and the sheet the client signs — read 15/09
    // above 12/08.
    const product = await prisma.product.create({
      data: { locationId, name: 'Vestido Ordem', category: 'festa', size: 'M', color: 'bege', rentalPrice: 800, depositAmount: 0 },
    })
    const created = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        clientId,
        eventDate: '2027-03-10',
        paymentMethod: 'PIX',
        items: [{ productId: product.id, checkoutDate: '2027-03-08', dueDate: '2027-03-12', priceCharged: 800 }],
      })
    for (const paidAt of ['2027-03-05', '2027-01-20']) {
      await request(app)
        .post(`/api/contracts/${created.body.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ amount: 100, method: 'PIX', paidAt })
    }

    const detail = await request(app)
      .get(`/api/contracts/${created.body.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
    const dates = detail.body.payments.map((payment: { paidAt: string }) => payment.paidAt.slice(0, 10))
    expect(dates).toEqual(['2027-01-20', '2027-03-05'])
  })

  it('CRITICAL: never lets a sub-centavo amount into the ledger', async () => {
    // The dialog's untouched prefill for "R$ 500,20 minus R$ 199,90" was
    // 300.29999999999995 — correct to any 2-decimal reading, so nothing looked
    // wrong, and then it joined every later `paid` sum and spread its drift to
    // contracts that had none. The server is the last line: whatever arrives,
    // whole centavos are what get stored.
    const product = await prisma.product.create({
      data: { locationId, name: 'Vestido Quantiza', category: 'festa', size: 'M', color: 'preto', rentalPrice: 500.2, depositAmount: 0 },
    })
    const created = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        clientId,
        eventDate: '2026-12-03',
        paymentMethod: 'PIX',
        items: [{ productId: product.id, checkoutDate: '2026-12-01', dueDate: '2026-12-05', priceCharged: 500.2 }],
      })

    const paid = await request(app)
      .post(`/api/contracts/${created.body.id}/payments`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: 300.29999999999995, method: 'PIX', paidAt: '2026-12-02' })
    expect(paid.status).toBe(201)

    const stored = await prisma.payment.findFirst({ where: { contractId: created.body.id } })
    expect(stored?.amount).toBe(300.3)

    // And a correction cannot be the way one gets in either.
    await request(app)
      .patch(`/api/contracts/${created.body.id}/payments/${stored!.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: 199.89999999999998 })
    const corrected = await prisma.payment.findUnique({ where: { id: stored!.id } })
    expect(corrected?.amount).toBe(199.9)
  })

  it('still reports a genuine one-centavo debt', async () => {
    // The floor must not swallow real money: rounding to centavos may not
    // become "close enough is settled".
    const product = await prisma.product.create({
      data: { locationId, name: 'Vestido Centavo', category: 'festa', size: 'P', color: 'verde', rentalPrice: 100, depositAmount: 0 },
    })
    const created = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        clientId,
        eventDate: '2026-11-03',
        paymentMethod: 'PIX',
        items: [{ productId: product.id, checkoutDate: '2026-11-01', dueDate: '2026-11-05', priceCharged: 100 }],
      })
    await request(app)
      .post(`/api/contracts/${created.body.id}/payments`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: 99.99, method: 'PIX', paidAt: '2026-11-02' })

    const summary = await request(app).get('/api/contracts/outstanding').set('Authorization', `Bearer ${staffToken}`)
    expect(summary.body.count).toBe(1)
    expect(summary.body.total).toBeCloseTo(0.01, 10)
  })
})
