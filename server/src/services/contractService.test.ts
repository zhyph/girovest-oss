import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { createContract } from './contractService.js'

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
})
