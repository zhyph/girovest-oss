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
  const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@example.com' } })
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

    expect(await isProductAvailableForRange(productId, new Date('2026-09-05'), new Date('2026-09-15'))).toBe(false)
    expect(await isProductAvailableForRange(productId, new Date('2026-09-11'), new Date('2026-09-20'))).toBe(true)
  })

  it('rejects checking out an allocation that is not reserved', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    await checkOutAllocation(allocation.id, {}, new Date('2026-09-01'))

    await expect(checkOutAllocation(allocation.id, {}, new Date('2026-09-01'))).rejects.toMatchObject({
      code: 'INVALID_ALLOCATION_TRANSITION',
    })
  })

  it('rejects checking out an allocation before its checkout date arrives', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })

    await expect(
      checkOutAllocation(allocation.id, {}, new Date('2026-08-31')),
    ).rejects.toMatchObject({ code: 'CHECKOUT_TOO_EARLY' })
  })

  it('rejects an early checkout when the override is explicitly false', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })

    await expect(
      checkOutAllocation(allocation.id, { allowEarly: false }, new Date('2026-08-31')),
    ).rejects.toMatchObject({ code: 'CHECKOUT_TOO_EARLY' })
  })

  it('allows checking out exactly on the checkout date', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })

    const result = await checkOutAllocation(allocation.id, {}, new Date('2026-09-01'))
    expect(result.status).toBe('checked_out')
  })

  it('records the actual checkout instant on an on-time checkout', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    const asOf = new Date('2026-09-02T14:30:00.000Z')

    const result = await checkOutAllocation(allocation.id, {}, asOf)
    expect(result.actualCheckoutDate).toEqual(asOf)
    // The contracted date printed on the signed contract is never rewritten.
    expect(result.checkoutDate).toEqual(new Date('2026-09-01'))
  })

  it('allows an early checkout when the caller explicitly overrides the block', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    const asOf = new Date('2026-08-28T10:00:00.000Z')

    const result = await checkOutAllocation(allocation.id, { allowEarly: true }, asOf)
    expect(result.status).toBe('checked_out')
    expect(result.actualCheckoutDate).toEqual(asOf)
    expect(result.checkoutDate).toEqual(new Date('2026-09-01'))
  })

  it('CRITICAL: an early checkout blocks the days between the real pickup and the planned checkout date', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    await checkOutAllocation(allocation.id, { allowEarly: true }, new Date('2026-08-28T10:00:00.000Z'))

    // The dress is physically out of the store from Aug 28 — those days must
    // not read as bookable just because the plan said Sep 1.
    expect(await isProductAvailableForRange(productId, new Date('2026-08-29'), new Date('2026-08-31'))).toBe(false)
    expect(await getProductAvailability(productId, new Date('2026-08-29'))).toBe('rented')
  })

  it('does not let the early override bypass the status guard', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    await checkOutAllocation(allocation.id, { allowEarly: true }, new Date('2026-08-28'))

    await expect(
      checkOutAllocation(allocation.id, { allowEarly: true }, new Date('2026-08-29')),
    ).rejects.toMatchObject({ code: 'INVALID_ALLOCATION_TRANSITION' })
  })

  it('rejects returning an allocation that is not checked out', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })

    await expect(returnAllocation(allocation.id, {})).rejects.toMatchObject({
      code: 'INVALID_ALLOCATION_TRANSITION',
    })
  })

  it('returns a checked-out allocation', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    await checkOutAllocation(allocation.id, {}, new Date('2026-09-01'))

    const result = await returnAllocation(allocation.id, { conditionNotesIn: 'ok', depositReturned: 50 })
    expect(result.status).toBe('returned')
  })

  it('cancels a reserved allocation and frees the product', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    await cancelAllocation(allocation.id)

    expect(await isProductAvailableForRange(productId, new Date('2026-09-01'), new Date('2026-09-05'))).toBe(true)
  })

  it('rejects cancelling an allocation that is not reserved', async () => {
    const allocation = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    await checkOutAllocation(allocation.id, {}, new Date('2026-09-01'))

    await expect(cancelAllocation(allocation.id)).rejects.toMatchObject({
      code: 'INVALID_ALLOCATION_TRANSITION',
    })
  })

  it('is available when there is no allocation at all', async () => {
    expect(await getProductAvailability(productId, new Date('2026-09-01'))).toBe('available')
  })

  it('lists all allocations, newest first', async () => {
    const first = await seedReservedAllocation({ checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-05') })
    await cancelAllocation(first.id)
    const second = await seedReservedAllocation({ checkoutDate: new Date('2026-10-01'), dueDate: new Date('2026-10-05') })

    const all = await listAllocations()
    expect(all.map((a) => a.id)).toEqual([second.id, first.id])
  })
})
