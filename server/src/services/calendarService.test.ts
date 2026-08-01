import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { listGoingOut, listDueBack, listOverdue } from './calendarService.js'
import { seedTwoLocations } from '../testHelpers/twoLocationFixture.js'

let locationId: string
let staffId: string
let clientId: string
let productId: string

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  locationId = location.id
  const staff = await prisma.staff.create({
    data: { name: 'S', login: `staff-cal-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId },
  })
  staffId = staff.id
  const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@example.com', locationId } })
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

describe('calendarService', () => {
  it('lists reserved allocations checking out within a range', async () => {
    await prisma.allocation.create({
      data: {
        productId, clientId, staffId,
        checkoutDate: new Date('2026-09-10'), dueDate: new Date('2026-09-15'),
        status: 'reserved', priceCharged: 100,
      },
    })

    const results = await listGoingOut(locationId, new Date('2026-09-01'), new Date('2026-09-30'))
    expect(results).toHaveLength(1)
  })

  it('lists checked_out allocations due back within a range', async () => {
    await prisma.allocation.create({
      data: {
        productId, clientId, staffId,
        checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-10'),
        status: 'checked_out', priceCharged: 100,
      },
    })

    const results = await listDueBack(locationId, new Date('2026-09-05'), new Date('2026-09-15'))
    expect(results).toHaveLength(1)
  })

  it('lists overdue allocations: checked_out with due date in the past', async () => {
    await prisma.allocation.create({
      data: {
        productId, clientId, staffId,
        checkoutDate: new Date('2026-01-01'), dueDate: new Date('2026-01-05'),
        status: 'checked_out', priceCharged: 100,
      },
    })

    const results = await listOverdue(locationId, new Date('2026-07-17'))
    expect(results).toHaveLength(1)
  })

  it('keeps overdue and due-back keyed on the due date after an early check-out', async () => {
    await prisma.allocation.create({
      data: {
        productId, clientId, staffId,
        checkoutDate: new Date('2026-01-10'),
        // Picked up a week before the contracted date.
        actualCheckoutDate: new Date('2026-01-03'),
        dueDate: new Date('2026-01-15'),
        status: 'checked_out', priceCharged: 100,
      },
    })

    // Lateness is measured against the promised return date only — an early
    // pickup neither creates nor clears an overdue.
    expect(await listOverdue(locationId, new Date('2026-01-12'))).toHaveLength(0)
    expect(await listOverdue(locationId, new Date('2026-01-20'))).toHaveLength(1)
    expect(await listDueBack(locationId, new Date('2026-01-14'), new Date('2026-01-16'))).toHaveLength(1)
    // Once checked out it is no longer "saindo" on its planned checkout day.
    expect(await listGoingOut(locationId, new Date('2026-01-01'), new Date('2026-01-31'))).toHaveLength(0)
  })

  it('does not count a returned allocation as overdue', async () => {
    await prisma.allocation.create({
      data: {
        productId, clientId, staffId,
        checkoutDate: new Date('2026-01-01'), dueDate: new Date('2026-01-05'),
        actualReturnDate: new Date('2026-01-04'),
        status: 'returned', priceCharged: 100,
      },
    })

    const results = await listOverdue(locationId, new Date('2026-07-17'))
    expect(results).toHaveLength(0)
  })
})

// Calendar has no locationId column of its own — listGoingOut/listDueBack/
// listOverdue all reach location only through Allocation -> Product, so each
// case below seeds a matching allocation on the OTHER location to prove the
// product-relation filter, not a status/date guard, is what's excluding it.
describe('calendarService cross-location isolation', () => {
  it('only returns going-out allocations for the given location', async () => {
    const { locationA, staffA, staffB, clientA, clientB, productA, productB } = await seedTwoLocations()
    const allocationA = await prisma.allocation.create({
      data: {
        productId: productA.id, clientId: clientA.id, staffId: staffA.id,
        checkoutDate: new Date('2026-09-10'), dueDate: new Date('2026-09-15'),
        status: 'reserved', priceCharged: 100,
      },
    })
    await prisma.allocation.create({
      data: {
        productId: productB.id, clientId: clientB.id, staffId: staffB.id,
        checkoutDate: new Date('2026-09-10'), dueDate: new Date('2026-09-15'),
        status: 'reserved', priceCharged: 100,
      },
    })

    const results = await listGoingOut(locationA.id, new Date('2026-09-01'), new Date('2026-09-30'))
    expect(results.map((a) => a.id)).toEqual([allocationA.id])
  })

  it('only returns due-back allocations for the given location', async () => {
    const { locationA, staffA, staffB, clientA, clientB, productA, productB } = await seedTwoLocations()
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

    const results = await listDueBack(locationA.id, new Date('2026-09-05'), new Date('2026-09-15'))
    expect(results.map((a) => a.id)).toEqual([allocationA.id])
  })

  it('only returns overdue allocations for the given location', async () => {
    const { locationA, staffA, staffB, clientA, clientB, productA, productB } = await seedTwoLocations()
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

    const results = await listOverdue(locationA.id, new Date('2026-07-17'))
    expect(results.map((a) => a.id)).toEqual([allocationA.id])
  })
})
