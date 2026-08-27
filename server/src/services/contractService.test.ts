import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import {
  createContract,
  cancelContract,
  listContracts,
  getContract,
  createPayment,
  updatePayment,
  deletePayment,
  sumOutstanding,
} from './contractService.js'
import { checkOutAllocation } from './allocationService.js'

let locationId: string
let staffId: string
let clientId: string
let productId: string
let secondProductId: string

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  locationId = location.id
  const staff = await prisma.staff.create({
    data: { name: 'S', login: `staff-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId },
  })
  staffId = staff.id
  const client = await prisma.client.create({ data: { locationId, name: 'C', phone: '1', email: 'c@example.com' } })
  clientId = client.id
  const product = await prisma.product.create({
    data: { locationId, name: 'Vestido', category: 'festa', size: 'M', color: 'azul', rentalPrice: 100, depositAmount: 50 },
  })
  productId = product.id
  const secondProduct = await prisma.product.create({
    data: { locationId, name: 'Vestido 2', category: 'festa', size: 'P', color: 'vermelho', rentalPrice: 150, depositAmount: 75 },
  })
  secondProductId = secondProduct.id
})

afterEach(async () => {
  await prisma.payment.deleteMany()
  await prisma.allocation.deleteMany()
  await prisma.contract.deleteMany()
  await prisma.product.deleteMany()
  await prisma.client.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

function baseInput(overrides: Partial<Parameters<typeof createContract>[0]> = {}) {
  return {
    locationId,
    clientId,
    staffId,
    eventDate: new Date('2026-10-03'),
    paymentMethod: 'PIX',
    items: [
      { productId, checkoutDate: new Date('2026-10-02'), dueDate: new Date('2026-10-05'), priceCharged: 100 },
    ],
    ...overrides,
  }
}

describe('createContract', () => {
  it('creates a Contract with its Allocations in one call, with no payments logged yet', async () => {
    const contract = await createContract(baseInput())

    expect(contract.locationId).toBe(locationId)
    expect(contract.clientId).toBe(clientId)
    expect(contract.paymentMethod).toBe('PIX')
    expect(contract.signatureStatus).toBe('unsigned')
    expect(contract.allocations).toHaveLength(1)
    expect(contract.allocations[0].status).toBe('reserved')
    expect(contract.allocations[0].contractId).toBe(contract.id)
    // Creation is payment-free — the first payment (e.g. a deposit) is
    // logged afterward from the contract's own screen, same as every later
    // one.
    expect(contract.payments).toEqual([])
  })

  it('creates one Allocation per item for a multi-item contract', async () => {
    const contract = await createContract(
      baseInput({
        items: [
          { productId, checkoutDate: new Date('2026-10-02'), dueDate: new Date('2026-10-05'), priceCharged: 100 },
          { productId: secondProductId, checkoutDate: new Date('2026-10-02'), dueDate: new Date('2026-10-05'), priceCharged: 150 },
        ],
      }),
    )

    expect(contract.allocations).toHaveLength(2)
    const productIds = contract.allocations.map((allocation) => allocation.productId).sort()
    expect(productIds).toEqual([productId, secondProductId].sort())
  })

  it('assigns sequential numbers per Location, starting at 1', async () => {
    const first = await createContract(baseInput())
    const second = await createContract(
      baseInput({ items: [{ productId: secondProductId, checkoutDate: new Date('2026-11-01'), dueDate: new Date('2026-11-05'), priceCharged: 150 }] }),
    )

    expect(first.number).toBe(1)
    expect(second.number).toBe(2)
  })

  it('rejects a contract with no items', async () => {
    await expect(createContract(baseInput({ items: [] }))).rejects.toThrow(AppError)
  })

  it('rejects an item whose due date is before its checkout date', async () => {
    await expect(
      createContract(
        baseInput({ items: [{ productId, checkoutDate: new Date('2026-10-05'), dueDate: new Date('2026-10-02'), priceCharged: 100 }] }),
      ),
    ).rejects.toThrow(AppError)
  })

  it('rejects an item referencing a product that is not active', async () => {
    await prisma.product.update({ where: { id: productId }, data: { status: 'retired' } })

    await expect(createContract(baseInput())).rejects.toThrow(AppError)
  })

  it('rejects an item referencing a product from another location', async () => {
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'B' } })
    const otherProduct = await prisma.product.create({
      data: { locationId: otherLocation.id, name: 'Vestido 3', category: 'festa', size: 'G', color: 'verde', rentalPrice: 200, depositAmount: 100 },
    })

    await expect(
      createContract(baseInput({ items: [{ productId: otherProduct.id, checkoutDate: new Date('2026-10-02'), dueDate: new Date('2026-10-05'), priceCharged: 200 }] })),
    ).rejects.toThrow(AppError)
  })

  it('rejects an item whose product is already reserved for an overlapping range', async () => {
    await createContract(baseInput())

    await expect(
      createContract(
        baseInput({ items: [{ productId, checkoutDate: new Date('2026-10-03'), dueDate: new Date('2026-10-04'), priceCharged: 100 }] }),
      ),
    ).rejects.toThrow(AppError)
  })

  it('rejects a contract that lists the same product twice with overlapping dates', async () => {
    await expect(
      createContract(
        baseInput({
          items: [
            { productId, checkoutDate: new Date('2026-10-02'), dueDate: new Date('2026-10-05'), priceCharged: 100 },
            { productId, checkoutDate: new Date('2026-10-03'), dueDate: new Date('2026-10-06'), priceCharged: 100 },
          ],
        }),
      ),
    ).rejects.toThrow(AppError)
  })

  it('CRITICAL: only one of two concurrent contract attempts for the same overlapping product/dates succeeds', async () => {
    const attempt = () =>
      createContract(
        baseInput({
          items: [
            { productId, checkoutDate: new Date('2026-10-02'), dueDate: new Date('2026-10-05'), priceCharged: 100 },
          ],
        }),
      )

    const results = await Promise.allSettled([attempt(), attempt()])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
  })

  it('assigns unique sequential numbers to concurrent contracts for the same location on different products', async () => {
    // NOTE: this passes even with the retry loop deleted — better-sqlite3
    // serializes transactions, so the two attempts never actually collide
    // under the test provider. Kept as a shape check only; the test below is
    // the one that actually holds the retry down.
    const attemptWithProduct = (product: string) =>
      createContract(
        baseInput({
          items: [{ productId: product, checkoutDate: new Date('2026-10-02'), dueDate: new Date('2026-10-05'), priceCharged: 100 }],
        }),
      )

    const results = await Promise.allSettled([attemptWithProduct(productId), attemptWithProduct(secondProductId)])
    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createContract>>> => r.status === 'fulfilled',
    )

    expect(fulfilled).toHaveLength(2)
    const numbers = fulfilled.map((r) => r.value.number).sort((a, b) => a - b)
    expect(numbers).toEqual([1, 2])
  })

  it('CRITICAL: re-reads and takes the next free number when a racer wins the unique constraint', async () => {
    // The real race, forced: another staff member claims number 1 between this
    // attempt's read and its write. Deleting the retry loop makes this throw;
    // keeping it but reusing the number computed on the first attempt makes it
    // come back as 1 instead of 2. Neither failure is caught by the
    // Promise.allSettled test above, which never actually collides under
    // better-sqlite3's serialized transactions.
    const realTransaction = prisma.$transaction.bind(prisma)
    let attempts = 0
    const spy = vi.spyOn(prisma, '$transaction').mockImplementation((async (...args: unknown[]) => {
      attempts += 1
      if (attempts === 1) {
        await prisma.contract.create({
          data: {
            number: 1,
            locationId,
            clientId,
            staffId,
            eventDate: new Date('2026-10-01'),
            paymentMethod: 'Dinheiro',
          },
        })
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        })
      }
      return (realTransaction as (...a: never[]) => unknown)(...(args as never[]))
    }) as never)

    try {
      const contract = await createContract(baseInput())
      expect(attempts).toBe(2)
      expect(contract.number).toBe(2)
    } finally {
      spy.mockRestore()
    }
  })

  it('gives up with a 409 rather than looping forever on unending write conflicts', async () => {
    const spy = vi.spyOn(prisma, '$transaction').mockImplementation((() =>
      Promise.reject(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      )) as never)

    try {
      await expect(createContract(baseInput())).rejects.toMatchObject({ status: 409 })
      expect(spy).toHaveBeenCalledTimes(5)
    } finally {
      spy.mockRestore()
    }
  })

  it('does not swallow an unrelated database error as a write conflict', async () => {
    const spy = vi.spyOn(prisma, '$transaction').mockImplementation((() =>
      Promise.reject(new Error('disk is on fire'))) as never)

    try {
      await expect(createContract(baseInput())).rejects.toThrow('disk is on fire')
      // One attempt, not five: only P2002/P2034 are retryable.
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('CRITICAL: a product taken out early cannot be booked for the days between the real pickup and its planned checkout date', async () => {
    const contract = await createContract(baseInput())
    await checkOutAllocation(locationId, contract.allocations[0].id, { allowEarly: true }, new Date('2026-09-25T09:00:00.000Z'))

    // The dress left the store on Sep 25 even though the contract said Oct 2 —
    // those days are physically taken and must not be bookable.
    await expect(
      createContract(
        baseInput({
          items: [
            { productId, checkoutDate: new Date('2026-09-26'), dueDate: new Date('2026-09-28'), priceCharged: 100 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' })
  })

  it('throws NOT_FOUND when the client belongs to a different location than the contract', async () => {
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'X' } })
    const clientElsewhere = await prisma.client.create({
      data: { locationId: otherLocation.id, name: 'C', phone: '1', email: 'c@x.com' },
    })

    await expect(
      createContract(
        baseInput({
          clientId: clientElsewhere.id,
        }),
      ),
    ).rejects.toThrow(AppError)
  })
})

describe('cancelContract', () => {
  it('cancels all reserved allocations under the contract', async () => {
    const contract = await createContract(
      baseInput({
        items: [
          { productId, checkoutDate: new Date('2026-10-02'), dueDate: new Date('2026-10-05'), priceCharged: 100 },
          { productId: secondProductId, checkoutDate: new Date('2026-10-02'), dueDate: new Date('2026-10-05'), priceCharged: 150 },
        ],
      }),
    )

    const cancelled = await cancelContract(contract.id, locationId)

    expect(cancelled.allocations.every((allocation) => allocation.status === 'cancelled')).toBe(true)
  })

  it('leaves already checked-out allocations untouched', async () => {
    const contract = await createContract(baseInput())
    await prisma.allocation.update({ where: { id: contract.allocations[0].id }, data: { status: 'checked_out' } })

    const cancelled = await cancelContract(contract.id, locationId)

    expect(cancelled.allocations[0].status).toBe('checked_out')
  })

  it('throws NOT_FOUND for a missing contract', async () => {
    await expect(cancelContract('does-not-exist', locationId)).rejects.toThrow(AppError)
  })

  it('throws NOT_FOUND for a contract belonging to another location', async () => {
    const contract = await createContract(baseInput())
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'B' } })

    await expect(cancelContract(contract.id, otherLocation.id)).rejects.toThrow(AppError)
  })
})

describe('listContracts', () => {
  it('lists contracts with their allocations and payments', async () => {
    const contract = await createContract(baseInput())
    await createPayment(contract.id, locationId, staffId, { amount: 50, method: 'PIX', paidAt: new Date('2026-09-25') })

    const { contracts } = await listContracts(locationId)

    expect(contracts).toHaveLength(1)
    expect(contracts[0].allocations).toHaveLength(1)
    expect(contracts[0].payments).toHaveLength(1)
  })

  it('does not list contracts belonging to another location', async () => {
    await createContract(baseInput())
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'B' } })

    const { contracts } = await listContracts(otherLocation.id)

    expect(contracts).toHaveLength(0)
  })
})

describe('listContracts pagination and search', () => {
  it('returns only pageSize contracts per page, newest first', async () => {
    const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
    const staff = await prisma.staff.create({ data: { name: 'S', login: `s-${Date.now()}`, passwordHash: 'x', role: 'staff', locationId: location.id } })
    const client = await prisma.client.create({ data: { locationId: location.id, name: 'C', phone: '1', email: 'c@e.com' } })
    for (let i = 0; i < 25; i++) {
      await prisma.contract.create({
        data: { number: i + 1, locationId: location.id, clientId: client.id, staffId: staff.id, eventDate: new Date(), paymentMethod: 'PIX' },
      })
    }
    const result = await listContracts(location.id, { page: 1, pageSize: 20, search: '' })
    expect(result.contracts).toHaveLength(20)
    expect(result.total).toBe(25)
    const page2 = await listContracts(location.id, { page: 2, pageSize: 20, search: '' })
    expect(page2.contracts).toHaveLength(5)
  })

  it('searches by client name, case-insensitive', async () => {
    const location = await prisma.location.create({ data: { name: 'L2', address: 'A' } })
    const staff = await prisma.staff.create({ data: { name: 'S', login: `s2-${Date.now()}`, passwordHash: 'x', role: 'staff', locationId: location.id } })
    const client = await prisma.client.create({ data: { locationId: location.id, name: 'Maria Silva', phone: '1', email: 'm@e.com' } })
    await prisma.contract.create({
      data: { number: 1, locationId: location.id, clientId: client.id, staffId: staff.id, eventDate: new Date(), paymentMethod: 'PIX' },
    })
    const result = await listContracts(location.id, { page: 1, pageSize: 20, search: 'maria' })
    expect(result.contracts).toHaveLength(1)
    const noMatch = await listContracts(location.id, { page: 1, pageSize: 20, search: 'nobody' })
    expect(noMatch.contracts).toHaveLength(0)
  })

  it('searches by contract number', async () => {
    const location = await prisma.location.create({ data: { name: 'L3', address: 'A' } })
    const staff = await prisma.staff.create({ data: { name: 'S', login: `s3-${Date.now()}`, passwordHash: 'x', role: 'staff', locationId: location.id } })
    const client = await prisma.client.create({ data: { locationId: location.id, name: 'Joana Souza', phone: '1', email: 'j@e.com' } })
    await prisma.contract.create({
      data: { number: 42, locationId: location.id, clientId: client.id, staffId: staff.id, eventDate: new Date(), paymentMethod: 'PIX' },
    })
    await prisma.contract.create({
      data: { number: 7, locationId: location.id, clientId: client.id, staffId: staff.id, eventDate: new Date(), paymentMethod: 'PIX' },
    })

    const result = await listContracts(location.id, { page: 1, pageSize: 20, search: '42' })
    expect(result.contracts).toHaveLength(1)
    expect(result.contracts[0].number).toBe(42)
  })

  it('returns zero results for a search term matching neither client name nor any contract number', async () => {
    const location = await prisma.location.create({ data: { name: 'L4', address: 'A' } })
    const staff = await prisma.staff.create({ data: { name: 'S', login: `s4-${Date.now()}`, passwordHash: 'x', role: 'staff', locationId: location.id } })
    const client = await prisma.client.create({ data: { locationId: location.id, name: 'Joana Souza', phone: '1', email: 'j2@e.com' } })
    await prisma.contract.create({
      data: { number: 42, locationId: location.id, clientId: client.id, staffId: staff.id, eventDate: new Date(), paymentMethod: 'PIX' },
    })

    const noMatch = await listContracts(location.id, { page: 1, pageSize: 20, search: '999' })
    expect(noMatch.contracts).toHaveLength(0)
  })

  it('falls back to name-only matching for a non-numeric search term without crashing', async () => {
    const location = await prisma.location.create({ data: { name: 'L5', address: 'A' } })
    const staff = await prisma.staff.create({ data: { name: 'S', login: `s5-${Date.now()}`, passwordHash: 'x', role: 'staff', locationId: location.id } })
    const client = await prisma.client.create({ data: { locationId: location.id, name: 'Joana Souza', phone: '1', email: 'j3@e.com' } })
    await prisma.contract.create({
      data: { number: 42, locationId: location.id, clientId: client.id, staffId: staff.id, eventDate: new Date(), paymentMethod: 'PIX' },
    })

    const result = await listContracts(location.id, { page: 1, pageSize: 20, search: 'joana' })
    expect(result.contracts).toHaveLength(1)

    const noMatch = await listContracts(location.id, { page: 1, pageSize: 20, search: 'not-a-number' })
    expect(noMatch.contracts).toHaveLength(0)
  })

  it('never returns a contract from a different location', async () => {
    const locationA = await prisma.location.create({ data: { name: 'LA', address: 'A' } })
    const locationB = await prisma.location.create({ data: { name: 'LB', address: 'A' } })
    const staffA = await prisma.staff.create({ data: { name: 'S', login: `sa-${Date.now()}`, passwordHash: 'x', role: 'staff', locationId: locationA.id } })
    const clientA = await prisma.client.create({ data: { locationId: locationA.id, name: 'X', phone: '1', email: 'x@e.com' } })
    await prisma.contract.create({
      data: { number: 1, locationId: locationB.id, clientId: clientA.id, staffId: staffA.id, eventDate: new Date(), paymentMethod: 'PIX' },
    })
    const result = await listContracts(locationA.id, { page: 1, pageSize: 20, search: '' })
    expect(result.total).toBe(0)
  })
})

describe('getContract', () => {
  it('returns the contract with nested client, location, and product details', async () => {
    await prisma.location.update({ where: { id: locationId }, data: { phone: '1199999999' } })
    await prisma.locationContractClause.createMany({
      data: [
        { locationId, sortOrder: 1, text: 'Clause two' },
        { locationId, sortOrder: 0, text: 'Clause one' },
      ],
    })
    await prisma.clientIdentityDocument.create({ data: { clientId, label: 'CPF', value: '123.456.789-00' } })
    await prisma.clientAddressLine.createMany({
      data: [
        { clientId, label: 'Cidade', value: 'São Paulo', sortOrder: 1 },
        { clientId, label: 'Endereço', value: 'Rua A, 100', sortOrder: 0 },
      ],
    })
    const created = await createContract(baseInput())

    const detail = await getContract(created.id, locationId)

    expect(detail.location.contractClauses.map((clause) => clause.text)).toEqual(['Clause one', 'Clause two'])
    expect(detail.client.addressLines.map((line) => line.label)).toEqual(['Endereço', 'Cidade'])
    expect(detail.client.identityDocuments[0]).toMatchObject({ label: 'CPF', value: '123.456.789-00' })
    expect(detail.allocations[0].product.name).toBe('Vestido')
    expect(detail.location.phone).toBe('1199999999')
  })

  it('throws NOT_FOUND for a missing contract', async () => {
    await expect(getContract('missing-id', locationId)).rejects.toThrow(AppError)
  })

  it('throws NOT_FOUND for a contract belonging to another location', async () => {
    const created = await createContract(baseInput())
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'B' } })

    await expect(getContract(created.id, otherLocation.id)).rejects.toThrow(AppError)
  })
})

describe('booking a piece that is already out on an active contract', () => {
  it('accepts a later booking for a piece a customer is currently holding', async () => {
    const first = await createContract(
      baseInput({
        items: [
          { productId, checkoutDate: new Date('2026-10-02'), dueDate: new Date('2026-10-05'), priceCharged: 100 },
        ],
      }),
    )
    // The dress physically leaves the store, so the allocation is checked_out
    // and its planned return is still ahead.
    await checkOutAllocation(locationId, first.allocations[0].id, {}, new Date('2026-10-02'))

    const second = await createContract(
      baseInput({
        eventDate: new Date('2026-11-15'),
        items: [
          { productId, checkoutDate: new Date('2026-11-14'), dueDate: new Date('2026-11-17'), priceCharged: 100 },
        ],
      }),
    )

    expect(second.allocations).toHaveLength(1)
    expect(second.allocations[0].productId).toBe(productId)
  })

  it('still refuses a booking that overlaps the days the piece is out', async () => {
    const first = await createContract(baseInput())
    await checkOutAllocation(locationId, first.allocations[0].id, {}, new Date('2026-10-02'))

    await expect(
      createContract(
        baseInput({
          items: [
            { productId, checkoutDate: new Date('2026-10-04'), dueDate: new Date('2026-10-08'), priceCharged: 100 },
          ],
        }),
      ),
    ).rejects.toThrow(AppError)
  })

  it('refuses a booking that lands inside the shop\'s cleaning window', async () => {
    await prisma.location.update({ where: { id: locationId }, data: { maintenanceBufferDays: 3 } })
    await createContract(baseInput())

    // Due Oct 5 plus three cleaning days blocks through Oct 8.
    await expect(
      createContract(
        baseInput({
          items: [
            { productId, checkoutDate: new Date('2026-10-07'), dueDate: new Date('2026-10-09'), priceCharged: 100 },
          ],
        }),
      ),
    ).rejects.toThrow(AppError)

    const afterCleaning = await createContract(
      baseInput({
        items: [
          { productId, checkoutDate: new Date('2026-10-09'), dueDate: new Date('2026-10-11'), priceCharged: 100 },
        ],
      }),
    )
    expect(afterCleaning.allocations).toHaveLength(1)
  })
})

describe('createPayment / updatePayment / deletePayment', () => {
  it('logs a payment against a contract', async () => {
    const contract = await createContract(baseInput())

    const updated = await createPayment(contract.id, locationId, staffId, {
      amount: 100,
      method: 'PIX',
      paidAt: new Date('2026-09-25'),
    })

    expect(updated.payments).toHaveLength(1)
    expect(updated.payments[0]).toMatchObject({ amount: 100, method: 'PIX' })
  })

  it('allows logging more than what is outstanding, rather than capping it', async () => {
    const contract = await createContract(baseInput())

    const updated = await createPayment(contract.id, locationId, staffId, {
      amount: 9999,
      method: 'Dinheiro',
      paidAt: new Date('2026-09-25'),
    })

    expect(updated.payments[0].amount).toBe(9999)
  })

  it('refuses to log a payment against a contract from another location', async () => {
    const contract = await createContract(baseInput())
    const otherLocation = await prisma.location.create({ data: { name: 'Outra', address: 'B' } })

    await expect(
      createPayment(contract.id, otherLocation.id, staffId, { amount: 100, method: 'PIX', paidAt: new Date() }),
    ).rejects.toThrow(AppError)
  })

  it('corrects a logged payment', async () => {
    const contract = await createContract(baseInput())
    const withPayment = await createPayment(contract.id, locationId, staffId, {
      amount: 100,
      method: 'PIX',
      paidAt: new Date('2026-09-25'),
    })

    const updated = await updatePayment(contract.id, withPayment.payments[0].id, locationId, { amount: 120 })

    expect(updated.payments[0].amount).toBe(120)
  })

  it('removes a logged payment', async () => {
    const contract = await createContract(baseInput())
    const withPayment = await createPayment(contract.id, locationId, staffId, {
      amount: 100,
      method: 'PIX',
      paidAt: new Date('2026-09-25'),
    })

    const updated = await deletePayment(contract.id, withPayment.payments[0].id, locationId)

    expect(updated.payments).toEqual([])
  })

  it('refuses to touch a payment belonging to another location', async () => {
    const contract = await createContract(baseInput())
    const withPayment = await createPayment(contract.id, locationId, staffId, {
      amount: 100,
      method: 'PIX',
      paidAt: new Date('2026-09-25'),
    })
    const otherLocation = await prisma.location.create({ data: { name: 'Outra', address: 'B' } })

    await expect(
      updatePayment(contract.id, withPayment.payments[0].id, otherLocation.id, { amount: 50 }),
    ).rejects.toThrow(AppError)
    await expect(deletePayment(contract.id, withPayment.payments[0].id, otherLocation.id)).rejects.toThrow(
      AppError,
    )
  })

  it('refuses a payment that belongs to a different contract', async () => {
    const first = await createContract(baseInput())
    const firstPayment = await createPayment(first.id, locationId, staffId, {
      amount: 100,
      method: 'PIX',
      paidAt: new Date('2026-09-25'),
    })
    const second = await createContract(
      baseInput({
        items: [
          { productId: secondProductId, checkoutDate: new Date('2026-10-02'), dueDate: new Date('2026-10-05'), priceCharged: 150 },
        ],
      }),
    )

    await expect(
      updatePayment(second.id, firstPayment.payments[0].id, locationId, { amount: 50 }),
    ).rejects.toThrow(AppError)
  })
})

describe('sumOutstanding', () => {
  it('sums the live pieces minus what has been paid, across every active contract', async () => {
    await createContract(baseInput())

    expect(await sumOutstanding(locationId)).toEqual({ total: 100, count: 1 })
  })

  it('subtracts logged payments from the total owed', async () => {
    const contract = await createContract(baseInput())
    await createPayment(contract.id, locationId, staffId, { amount: 40, method: 'PIX', paidAt: new Date('2026-09-25') })

    expect(await sumOutstanding(locationId)).toEqual({ total: 60, count: 1 })
  })

  it('floors a single contract at zero rather than letting it offset another contract\'s balance, and leaves it out of the count', async () => {
    const overpaid = await createContract(baseInput())
    await createPayment(overpaid.id, locationId, staffId, { amount: 500, method: 'PIX', paidAt: new Date('2026-09-25') })
    await createContract(
      baseInput({
        items: [
          { productId: secondProductId, checkoutDate: new Date('2026-10-02'), dueDate: new Date('2026-10-05'), priceCharged: 150 },
        ],
      }),
    )

    expect(await sumOutstanding(locationId)).toEqual({ total: 150, count: 1 })
  })

  it('CRITICAL: stops counting a contract once it is cancelled', async () => {
    const abandoned = await createContract(baseInput())
    const kept = await createContract(
      baseInput({
        items: [
          { productId: secondProductId, checkoutDate: new Date('2026-10-02'), dueDate: new Date('2026-10-05'), priceCharged: 150 },
        ],
      }),
    )

    expect(await sumOutstanding(locationId)).toEqual({ total: 250, count: 2 })

    await cancelContract(abandoned.id, locationId)

    expect(await sumOutstanding(locationId)).toEqual({ total: 150, count: 1 })
    expect(kept.id).toBeDefined()
  })

  it('never counts another location\'s contracts', async () => {
    await createContract(baseInput())
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'X' } })

    expect(await sumOutstanding(otherLocation.id)).toEqual({ total: 0, count: 0 })
  })
})

describe('listContracts status filters and counts', () => {
  const DAY = 24 * 60 * 60 * 1000

  async function seedStates() {
    // Reserved and unsigned: active, not overdue.
    const reserved = await createContract(baseInput())
    // Checked out and past due: active AND overdue.
    const late = await createContract(
      baseInput({
        items: [
          { productId: secondProductId, checkoutDate: new Date('2026-01-02'), dueDate: new Date('2026-01-05'), priceCharged: 100 },
        ],
      }),
    )
    await prisma.allocation.updateMany({ where: { contractId: late.id }, data: { status: 'checked_out' } })
    // Everything back and signed: neither active nor unsigned.
    const done = await createContract(
      baseInput({
        items: [
          { productId, checkoutDate: new Date('2027-03-02'), dueDate: new Date('2027-03-05'), priceCharged: 100 },
        ],
      }),
    )
    await prisma.allocation.updateMany({ where: { contractId: done.id }, data: { status: 'returned' } })
    await prisma.contract.update({ where: { id: done.id }, data: { signatureStatus: 'signed' } })
    return { reserved, late, done }
  }

  it('counts every view across the whole dataset, not just the requested page', async () => {
    const { reserved, late } = await seedStates()

    // One row per page: the counts must still describe all three contracts,
    // which is the entire point of computing them here rather than over
    // whatever the page happened to return.
    const result = await listContracts(locationId, { page: 1, pageSize: 1 })

    expect(result.contracts).toHaveLength(1)
    expect(result.counts).toEqual({ all: 3, active: 2, overdue: 1, unsigned: 2, outstanding: 3 })
    expect([reserved.id, late.id]).toContain(result.contracts[0].id === reserved.id ? reserved.id : late.id)
  })

  it('narrows the rows themselves, and pages within the narrowed set', async () => {
    const { late } = await seedStates()

    const result = await listContracts(locationId, { status: 'overdue' })

    expect(result.contracts.map((contract) => contract.id)).toEqual([late.id])
    // `total` drives pagination, so it has to follow the filter rather than
    // the whole dataset — otherwise a filtered list offers pages that are
    // empty when you reach them.
    expect(result.total).toBe(1)
    expect(result.counts.all).toBe(3)
  })

  it('treats a contract with nothing reserved or out as no longer active', async () => {
    const { done } = await seedStates()

    const active = await listContracts(locationId, { status: 'active' })
    expect(active.contracts.map((contract) => contract.id)).not.toContain(done.id)
  })

  it('leaves a cancelled contract out of active', async () => {
    const contract = await createContract(baseInput())
    await cancelContract(contract.id, locationId)

    const result = await listContracts(locationId, { status: 'active' })
    expect(result.contracts).toHaveLength(0)
    expect(result.counts.active).toBe(0)
  })

  it('CRITICAL: leaves a cancelled contract out of unsigned too', async () => {
    const contract = await createContract(baseInput())
    expect(contract.signatureStatus).toBe('unsigned')
    await cancelContract(contract.id, locationId)

    // "Sem assinatura" is a worklist. A contract cancelled before anyone
    // signed it can never be signed now, so leaving it in means the chip
    // counts an action nobody will ever take — forever.
    const result = await listContracts(locationId, { status: 'unsigned' })
    expect(result.contracts).toHaveLength(0)
    expect(result.counts.unsigned).toBe(0)
  })

  it('counts a piece due today as overdue and one due tomorrow as not', async () => {
    // The boundary the desktop's own badge draws: `asOf` comes from the
    // caller precisely so these two answers cannot drift apart.
    const asOf = new Date()
    const dueToday = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()))
    const dueTomorrow = new Date(dueToday.getTime() + DAY)

    const first = await createContract(baseInput())
    await prisma.allocation.updateMany({
      where: { contractId: first.id },
      data: { status: 'checked_out', dueDate: dueToday },
    })
    const second = await createContract(
      baseInput({
        items: [
          { productId: secondProductId, checkoutDate: new Date('2026-01-02'), dueDate: new Date('2026-01-05'), priceCharged: 100 },
        ],
      }),
    )
    await prisma.allocation.updateMany({
      where: { contractId: second.id },
      data: { status: 'checked_out', dueDate: dueTomorrow },
    })

    const result = await listContracts(locationId, { status: 'overdue', asOf: new Date(dueToday.getTime() + 1) })

    expect(result.contracts.map((contract) => contract.id)).toEqual([first.id])
  })

  it('measures the counts against the search, not against the chip', async () => {
    await seedStates()
    const otherClient = await prisma.client.create({
      data: { locationId, name: 'Cliente Sem Contrato', phone: '2', email: 'x@example.com' },
    })

    const result = await listContracts(locationId, { search: otherClient.name })

    expect(result.counts).toEqual({ all: 0, active: 0, overdue: 0, unsigned: 0, outstanding: 0 })
  })

  it('the outstanding filter lists only contracts with a positive balance', async () => {
    const owed = await createContract(baseInput())
    const settled = await createContract(
      baseInput({
        items: [
          { productId: secondProductId, checkoutDate: new Date('2026-10-02'), dueDate: new Date('2026-10-05'), priceCharged: 150 },
        ],
      }),
    )
    await createPayment(settled.id, locationId, staffId, { amount: 150, method: 'PIX', paidAt: new Date('2026-09-25') })

    const result = await listContracts(locationId, { status: 'outstanding' })

    expect(result.contracts.map((contract) => contract.id)).toEqual([owed.id])
    expect(result.total).toBe(1)
    expect(result.counts.outstanding).toBe(1)
  })
})
