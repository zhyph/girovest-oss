import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { createContract, cancelContract, listContracts, getContract } from './contractService.js'

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
  const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@example.com' } })
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
  await prisma.installment.deleteMany()
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
    installments: [{ dueDate: new Date('2026-09-20'), amount: 100 }],
    ...overrides,
  }
}

describe('createContract', () => {
  it('creates a Contract with its Allocations and Installments in one call', async () => {
    const contract = await createContract(baseInput())

    expect(contract.locationId).toBe(locationId)
    expect(contract.clientId).toBe(clientId)
    expect(contract.paymentMethod).toBe('PIX')
    expect(contract.signatureStatus).toBe('unsigned')
    expect(contract.allocations).toHaveLength(1)
    expect(contract.allocations[0].status).toBe('reserved')
    expect(contract.allocations[0].contractId).toBe(contract.id)
    expect(contract.installments).toHaveLength(1)
    expect(contract.installments[0].amount).toBe(100)
    expect(contract.installments[0].paid).toBe(false)
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

  it('creates a contract with zero installments', async () => {
    const contract = await createContract(baseInput({ installments: [] }))
    expect(contract.installments).toEqual([])
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

  it('CRITICAL: assigns unique sequential numbers to concurrent contracts for the same location on different products', async () => {
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
  it('lists contracts with their allocations and installments', async () => {
    await createContract(baseInput())

    const { contracts } = await listContracts(locationId)

    expect(contracts).toHaveLength(1)
    expect(contracts[0].allocations).toHaveLength(1)
    expect(contracts[0].installments).toHaveLength(1)
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
    const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@e.com' } })
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
    const client = await prisma.client.create({ data: { name: 'Maria Silva', phone: '1', email: 'm@e.com' } })
    await prisma.contract.create({
      data: { number: 1, locationId: location.id, clientId: client.id, staffId: staff.id, eventDate: new Date(), paymentMethod: 'PIX' },
    })
    const result = await listContracts(location.id, { page: 1, pageSize: 20, search: 'maria' })
    expect(result.contracts).toHaveLength(1)
    const noMatch = await listContracts(location.id, { page: 1, pageSize: 20, search: 'nobody' })
    expect(noMatch.contracts).toHaveLength(0)
  })

  it('never returns a contract from a different location', async () => {
    const locationA = await prisma.location.create({ data: { name: 'LA', address: 'A' } })
    const locationB = await prisma.location.create({ data: { name: 'LB', address: 'A' } })
    const staffA = await prisma.staff.create({ data: { name: 'S', login: `sa-${Date.now()}`, passwordHash: 'x', role: 'staff', locationId: locationA.id } })
    const clientA = await prisma.client.create({ data: { name: 'X', phone: '1', email: 'x@e.com' } })
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
