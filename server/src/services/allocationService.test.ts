import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import {
  checkOutAllocation,
  returnAllocation,
  cancelAllocation,
  getProductAvailability,
  isProductAvailableForRange,
  listAllocations,
} from './allocationService.js'
import { seedTwoLocations, expectNotFoundAcrossLocations } from '../testHelpers/twoLocationFixture.js'

let locationId: string
let staffId: string
let clientId: string
let productId: string

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  locationId = location.id
  const staff = await prisma.staff.create({
    data: { name: 'S', login: `staff-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId },
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

// Allocations are only ever created via contractService.createContract now
// (see contractService.test.ts for occupancy/retry/validation coverage of
// allocation creation itself). This helper seeds a reserved Allocation
// directly, bypassing the Contract layer, purely as test fixture setup for
// the allocation-lifecycle functions below.
function seedReservedAllocation(overrides: { checkoutDate: Date; dueDate: Date; priceCharged?: number }) {
  return prisma.allocation.create({
    data: {
      productId,
      clientId,
      staffId,
      checkoutDate: overrides.checkoutDate,
      dueDate: overrides.dueDate,
      status: 'reserved',
      priceCharged: overrides.priceCharged ?? 100,
    },
  })
}

describe('allocationService', () => {
  it('reports a range as unavailable only when it overlaps an existing allocation', async () => {
    await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-10') })

    expect(await isProductAvailableForRange(locationId, productId, new Date('2026-09-05'), new Date('2026-09-15'))).toBe(false)
    expect(await isProductAvailableForRange(locationId, productId, new Date('2026-09-11'), new Date('2026-09-20'))).toBe(true)
  })

  it('rejects checking out an allocation that is not reserved', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    await checkOutAllocation(locationId, allocation.id, {}, new Date('2026-09-01'))

    await expect(checkOutAllocation(locationId, allocation.id, {}, new Date('2026-09-01'))).rejects.toMatchObject({
      code: 'INVALID_ALLOCATION_TRANSITION',
    })
  })

  it('rejects checking out an allocation before its checkout date arrives', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })

    await expect(
      checkOutAllocation(locationId, allocation.id, {}, new Date('2026-08-31')),
    ).rejects.toMatchObject({ code: 'CHECKOUT_TOO_EARLY' })
  })

  it('rejects an early checkout when the override is explicitly false', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })

    await expect(
      checkOutAllocation(locationId, allocation.id, { allowEarly: false }, new Date('2026-08-31')),
    ).rejects.toMatchObject({ code: 'CHECKOUT_TOO_EARLY' })
  })

  it('allows checking out exactly on the checkout date', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })

    const result = await checkOutAllocation(locationId, allocation.id, {}, new Date('2026-09-01'))
    expect(result.status).toBe('checked_out')
  })

  it('records the actual checkout instant on an on-time checkout', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    const asOf = new Date('2026-09-02T14:30:00.000Z')

    const result = await checkOutAllocation(locationId, allocation.id, {}, asOf)
    expect(result.actualCheckoutDate).toEqual(asOf)
    // The contracted date printed on the signed contract is never rewritten.
    expect(result.checkoutDate).toEqual(new Date('2026-09-01'))
  })

  it('allows an early checkout when the caller explicitly overrides the block', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    const asOf = new Date('2026-08-28T10:00:00.000Z')

    const result = await checkOutAllocation(locationId, allocation.id, { allowEarly: true }, asOf)
    expect(result.status).toBe('checked_out')
    expect(result.actualCheckoutDate).toEqual(asOf)
    expect(result.checkoutDate).toEqual(new Date('2026-09-01'))
  })

  it('CRITICAL: an early checkout blocks the days between the real pickup and the planned checkout date', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    await checkOutAllocation(locationId, allocation.id, { allowEarly: true }, new Date('2026-08-28T10:00:00.000Z'))

    // The dress is physically out of the store from Aug 28 — those days must
    // not read as bookable just because the plan said Sep 1.
    expect(await isProductAvailableForRange(locationId, productId, new Date('2026-08-29'), new Date('2026-08-31'))).toBe(false)
    expect(await getProductAvailability(locationId, productId, new Date('2026-08-29'))).toBe('rented')
  })

  it('CRITICAL: refuses an early checkout that would take days already promised to someone else', async () => {
    // Another customer has this same dress reserved for Sep 26-28.
    const other = await seedReservedAllocation({ checkoutDate: new Date('2026-09-26'), dueDate: new Date('2026-09-28') })
    // This customer's own pickup is Oct 2, but they turn up on Sep 25.
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-10-02'), dueDate: new Date('2026-10-06') })

    // Confirming "retirar mesmo assim" cannot conjure a second physical dress.
    await expect(
      checkOutAllocation(locationId, allocation.id, { allowEarly: true }, new Date('2026-09-25T09:00:00.000Z')),
    ).rejects.toMatchObject({ code: 'EARLY_CHECKOUT_CONFLICT' })

    const untouched = await prisma.allocation.findUniqueOrThrow({ where: { id: allocation.id } })
    expect(untouched.status).toBe('reserved')
    expect(untouched.actualCheckoutDate).toBeNull()
    const stillReserved = await prisma.allocation.findUniqueOrThrow({ where: { id: other.id } })
    expect(stillReserved.status).toBe('reserved')
  })

  it('allows an early checkout when the days it claims are free', async () => {
    // An unrelated booking of the same dress, well clear of the claimed days.
    await seedReservedAllocation({ checkoutDate: new Date('2026-11-10'), dueDate: new Date('2026-11-12') })
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-10-02'), dueDate: new Date('2026-10-06') })

    const result = await checkOutAllocation(locationId, allocation.id, { allowEarly: true }, new Date('2026-09-25T09:00:00.000Z'))
    expect(result.status).toBe('checked_out')
  })

  it('does not consult later bookings when the checkout is not early', async () => {
    // The next customer's reservation starts after this one is due back; an
    // on-time pickup claims no extra days, so it must not be blocked by it.
    await seedReservedAllocation({ checkoutDate: new Date('2026-09-20'), dueDate: new Date('2026-09-25') })
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })

    const result = await checkOutAllocation(locationId, allocation.id, {}, new Date('2026-09-01T09:00:00.000Z'))
    expect(result.status).toBe('checked_out')
  })

  it('does not let the early override bypass the status guard', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    await checkOutAllocation(locationId, allocation.id, { allowEarly: true }, new Date('2026-08-28'))

    await expect(
      checkOutAllocation(locationId, allocation.id, { allowEarly: true }, new Date('2026-08-29')),
    ).rejects.toMatchObject({ code: 'INVALID_ALLOCATION_TRANSITION' })
  })

  it('rejects returning an allocation that is not checked out', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })

    await expect(returnAllocation(locationId, allocation.id, {})).rejects.toMatchObject({
      code: 'INVALID_ALLOCATION_TRANSITION',
    })
  })

  it('returns a checked-out allocation', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    await checkOutAllocation(locationId, allocation.id, {}, new Date('2026-09-01'))

    const result = await returnAllocation(locationId, allocation.id, { conditionNotesIn: 'ok', depositReturned: 50 })
    expect(result.status).toBe('returned')
  })

  it('cancels a reserved allocation and frees the product', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    await cancelAllocation(locationId, allocation.id)

    expect(await isProductAvailableForRange(locationId, productId, new Date('2026-09-01'), new Date('2026-09-05'))).toBe(true)
  })

  it('rejects cancelling an allocation that is not reserved', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    await checkOutAllocation(locationId, allocation.id, {}, new Date('2026-09-01'))

    await expect(cancelAllocation(locationId, allocation.id)).rejects.toMatchObject({
      code: 'INVALID_ALLOCATION_TRANSITION',
    })
  })

  it('is available when there is no allocation at all', async () => {
    expect(await getProductAvailability(locationId, productId, new Date('2026-09-01'))).toBe('available')
  })

  it('lists all allocations, newest first', async () => {
    const first = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    await cancelAllocation(locationId, first.id)
    const second = await seedReservedAllocation({ checkoutDate: new Date('2026-10-01'), dueDate: new Date('2026-10-05') })

    const all = await listAllocations(locationId)
    expect(all.map((a) => a.id)).toEqual([second.id, first.id])
  })
})

// Allocation has no locationId column — every guard below reaches location
// only through the product relation, so each case seeds a real Allocation on
// the OTHER location's product and drives it into the status the happy path
// would need in order to succeed, so a broken/missing location check would
// actually mutate the row (and trip a different assertion) instead of being
// masked by an unrelated status guard.
describe('allocationService cross-location isolation', () => {
  it('throws NOT_FOUND checking out an allocation belonging to another location', async () => {
    const { locationA, staffB, clientB, productB } = await seedTwoLocations()
    const allocation = await prisma.allocation.create({
      data: {
        productId: productB.id,
        clientId: clientB.id,
        staffId: staffB.id,
        checkoutDate: new Date('2026-09-01'),
        dueDate: new Date('2026-09-05'),
        status: 'reserved',
        priceCharged: 100,
      },
    })

    await expectNotFoundAcrossLocations(() =>
      checkOutAllocation(locationA.id, allocation.id, {}, new Date('2026-09-01')),
    )

    const untouched = await prisma.allocation.findUniqueOrThrow({ where: { id: allocation.id } })
    expect(untouched.status).toBe('reserved')
  })

  it('throws NOT_FOUND returning an allocation belonging to another location', async () => {
    const { locationA, staffB, clientB, productB } = await seedTwoLocations()
    const allocation = await prisma.allocation.create({
      data: {
        productId: productB.id,
        clientId: clientB.id,
        staffId: staffB.id,
        checkoutDate: new Date('2026-09-01'),
        dueDate: new Date('2026-09-05'),
        status: 'checked_out',
        actualCheckoutDate: new Date('2026-09-01'),
        priceCharged: 100,
      },
    })

    await expectNotFoundAcrossLocations(() => returnAllocation(locationA.id, allocation.id, {}))

    const untouched = await prisma.allocation.findUniqueOrThrow({ where: { id: allocation.id } })
    expect(untouched.status).toBe('checked_out')
  })

  it('throws NOT_FOUND cancelling an allocation belonging to another location', async () => {
    const { locationA, staffB, clientB, productB } = await seedTwoLocations()
    const allocation = await prisma.allocation.create({
      data: {
        productId: productB.id,
        clientId: clientB.id,
        staffId: staffB.id,
        checkoutDate: new Date('2026-09-01'),
        dueDate: new Date('2026-09-05'),
        status: 'reserved',
        priceCharged: 100,
      },
    })

    await expectNotFoundAcrossLocations(() => cancelAllocation(locationA.id, allocation.id))

    const untouched = await prisma.allocation.findUniqueOrThrow({ where: { id: allocation.id } })
    expect(untouched.status).toBe('reserved')
  })

  it('throws NOT_FOUND checking availability of a product belonging to another location', async () => {
    const { locationA, productB } = await seedTwoLocations()

    await expectNotFoundAcrossLocations(() =>
      getProductAvailability(locationA.id, productB.id, new Date('2026-09-01')),
    )
  })

  it('throws NOT_FOUND checking range availability of a product belonging to another location', async () => {
    const { locationA, productB } = await seedTwoLocations()

    await expectNotFoundAcrossLocations(() =>
      isProductAvailableForRange(locationA.id, productB.id, new Date('2026-09-01'), new Date('2026-09-05')),
    )
  })

  it("only returns the caller's own location's allocations, never another location's", async () => {
    const { locationA, staffA, staffB, clientA, clientB, productA, productB } = await seedTwoLocations()
    const allocationA = await prisma.allocation.create({
      data: {
        productId: productA.id,
        clientId: clientA.id,
        staffId: staffA.id,
        checkoutDate: new Date('2026-09-01'),
        dueDate: new Date('2026-09-05'),
        status: 'reserved',
        priceCharged: 100,
      },
    })
    await prisma.allocation.create({
      data: {
        productId: productB.id,
        clientId: clientB.id,
        staffId: staffB.id,
        checkoutDate: new Date('2026-09-01'),
        dueDate: new Date('2026-09-05'),
        status: 'reserved',
        priceCharged: 100,
      },
    })

    const results = await listAllocations(locationA.id)
    expect(results.map((a) => a.id)).toEqual([allocationA.id])
  })
})
