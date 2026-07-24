import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { runContractBackfill } from './contractBackfill.js'
import { DEFAULT_CONTRACT_CLAUSES } from '../constants/defaultContractClauses.js'

afterEach(async () => {
  await prisma.installment.deleteMany()
  await prisma.allocation.deleteMany()
  await prisma.contract.deleteMany()
  await prisma.locationContractClause.deleteMany()
  await prisma.product.deleteMany()
  await prisma.client.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

async function seedOrphanAllocation(locationId: string, staffId: string, clientId: string, createdAt: Date) {
  const product = await prisma.product.create({
    data: { locationId, name: 'Vestido', category: 'festa', size: 'M', color: 'azul', rentalPrice: 100, depositAmount: 50 },
  })
  return prisma.allocation.create({
    data: {
      productId: product.id,
      clientId,
      staffId,
      checkoutDate: new Date('2026-01-01'),
      dueDate: new Date('2026-01-05'),
      status: 'returned',
      priceCharged: 100,
      createdAt,
    },
  })
}

describe('runContractBackfill', () => {
  it('creates one Contract per orphan Allocation, linked back via contractId', async () => {
    const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
    const staff = await prisma.staff.create({
      data: { name: 'S', login: `staff-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId: location.id },
    })
    const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@example.com' } })
    const allocationA = await seedOrphanAllocation(location.id, staff.id, client.id, new Date('2026-01-01T00:00:00Z'))
    const allocationB = await seedOrphanAllocation(location.id, staff.id, client.id, new Date('2026-01-02T00:00:00Z'))

    await runContractBackfill()

    const refreshedA = await prisma.allocation.findUniqueOrThrow({ where: { id: allocationA.id } })
    const refreshedB = await prisma.allocation.findUniqueOrThrow({ where: { id: allocationB.id } })
    expect(refreshedA.contractId).not.toBeNull()
    expect(refreshedB.contractId).not.toBeNull()
    expect(refreshedA.contractId).not.toBe(refreshedB.contractId)

    const contracts = await prisma.contract.findMany({ where: { locationId: location.id } })
    expect(contracts).toHaveLength(2)
  })

  it('assigns sequential numbers per Location, ordered by the Allocation createdAt', async () => {
    const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
    const staff = await prisma.staff.create({
      data: { name: 'S', login: `staff-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId: location.id },
    })
    const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@example.com' } })
    // Created out of chronological order on purpose.
    const later = await seedOrphanAllocation(location.id, staff.id, client.id, new Date('2026-01-05T00:00:00Z'))
    const earlier = await seedOrphanAllocation(location.id, staff.id, client.id, new Date('2026-01-01T00:00:00Z'))

    await runContractBackfill()

    const earlierContract = await prisma.contract.findFirstOrThrow({
      where: { allocations: { some: { id: earlier.id } } },
    })
    const laterContract = await prisma.contract.findFirstOrThrow({
      where: { allocations: { some: { id: later.id } } },
    })
    expect(earlierContract.number).toBe(1)
    expect(laterContract.number).toBe(2)
  })

  it('copies clientId and staffId from the Allocation onto the backfilled Contract', async () => {
    const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
    const staff = await prisma.staff.create({
      data: { name: 'S', login: `staff-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId: location.id },
    })
    const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@example.com' } })
    const allocation = await seedOrphanAllocation(location.id, staff.id, client.id, new Date('2026-01-01'))

    await runContractBackfill()

    const refreshed = await prisma.allocation.findUniqueOrThrow({ where: { id: allocation.id } })
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: refreshed.contractId! } })
    expect(contract.clientId).toBe(client.id)
    expect(contract.staffId).toBe(staff.id)
    expect(contract.signatureStatus).toBe('unsigned')
  })

  it('seeds default clauses for a Location with none', async () => {
    const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })

    await runContractBackfill()

    const clauses = await prisma.locationContractClause.findMany({
      where: { locationId: location.id },
      orderBy: { sortOrder: 'asc' },
    })
    expect(clauses.map((clause) => clause.text)).toEqual(DEFAULT_CONTRACT_CLAUSES)
  })

  it('does not duplicate clauses for a Location that already has them', async () => {
    const location = await prisma.location.create({
      data: {
        name: 'L',
        address: 'A',
        contractClauses: { create: [{ text: 'Custom clause', sortOrder: 0 }] },
      },
    })

    await runContractBackfill()

    const clauses = await prisma.locationContractClause.findMany({ where: { locationId: location.id } })
    expect(clauses).toHaveLength(1)
    expect(clauses[0].text).toBe('Custom clause')
  })

  it('is idempotent: running twice does not create duplicate Contracts or clauses', async () => {
    const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
    const staff = await prisma.staff.create({
      data: { name: 'S', login: `staff-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId: location.id },
    })
    const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@example.com' } })
    await seedOrphanAllocation(location.id, staff.id, client.id, new Date('2026-01-01'))

    await runContractBackfill()
    await runContractBackfill()

    const contracts = await prisma.contract.findMany({ where: { locationId: location.id } })
    expect(contracts).toHaveLength(1)
    const clauses = await prisma.locationContractClause.findMany({ where: { locationId: location.id } })
    expect(clauses).toHaveLength(DEFAULT_CONTRACT_CLAUSES.length)
  })

  it('does nothing when there are no orphan Allocations and every Location already has clauses', async () => {
    await prisma.location.create({
      data: {
        name: 'L',
        address: 'A',
        contractClauses: { create: DEFAULT_CONTRACT_CLAUSES.map((text, index) => ({ text, sortOrder: index })) },
      },
    })

    await expect(runContractBackfill()).resolves.toBeUndefined()
  })
})
