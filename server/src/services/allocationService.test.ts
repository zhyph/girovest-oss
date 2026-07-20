import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import {
  createAllocation,
  checkOutAllocation,
  returnAllocation,
  cancelAllocation,
  getProductAvailability,
  isProductAvailableForRange,
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

describe('allocationService', () => {
  it('creates a reserved allocation for a free product', async () => {
    const allocation = await createAllocation({
      productId, clientId, staffId,
      checkoutDate: new Date('2026-09-01'),
      dueDate: new Date('2026-09-05'),
      priceCharged: 100,
    })
    expect(allocation.status).toBe('reserved')
    expect(await getProductAvailability(productId, new Date('2026-09-03'))).toBe('reserved')
  })

  it('rejects a due date before the checkout date', async () => {
    await expect(
      createAllocation({
        productId, clientId, staffId,
        checkoutDate: new Date('2026-09-05'),
        dueDate: new Date('2026-09-01'),
        priceCharged: 100,
      }),
    ).rejects.toMatchObject({ code: 'DUE_DATE_BEFORE_CHECKOUT' })
  })

  it('reports a range as unavailable only when it overlaps an existing allocation', async () => {
    await createAllocation({
      productId, clientId, staffId,
      checkoutDate: new Date('2026-09-01'),
      dueDate: new Date('2026-09-10'),
      priceCharged: 100,
    })

    expect(await isProductAvailableForRange(productId, new Date('2026-09-05'), new Date('2026-09-15'))).toBe(false)
    expect(await isProductAvailableForRange(productId, new Date('2026-09-11'), new Date('2026-09-20'))).toBe(true)
  })

  it('rejects an overlapping allocation on the same product', async () => {
    await createAllocation({
      productId, clientId, staffId,
      checkoutDate: new Date('2026-09-01'),
      dueDate: new Date('2026-09-10'),
      priceCharged: 100,
    })

    await expect(
      createAllocation({
        productId, clientId, staffId,
        checkoutDate: new Date('2026-09-05'),
        dueDate: new Date('2026-09-15'),
        priceCharged: 100,
      }),
    ).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' })
  })

  it('CRITICAL: rejects a new allocation after a checked_out one is overdue and not yet returned', async () => {
    const first = await createAllocation({
      productId, clientId, staffId,
      checkoutDate: new Date('2026-09-01'),
      dueDate: new Date('2026-09-05'),
      priceCharged: 100,
    })
    await checkOutAllocation(first.id, {})

    // due_date (Sep 5) has passed; product is still physically out.
    await expect(
      createAllocation({
        productId, clientId, staffId,
        checkoutDate: new Date('2026-09-20'),
        dueDate: new Date('2026-09-25'),
        priceCharged: 100,
      }),
    ).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' })
  })

  it('allows a new allocation once the previous one is returned', async () => {
    const first = await createAllocation({
      productId, clientId, staffId,
      checkoutDate: new Date('2026-09-01'),
      dueDate: new Date('2026-09-05'),
      priceCharged: 100,
    })
    await checkOutAllocation(first.id, {})
    await returnAllocation(first.id, {})

    const second = await createAllocation({
      productId, clientId, staffId,
      checkoutDate: new Date('2026-09-20'),
      dueDate: new Date('2026-09-25'),
      priceCharged: 100,
    })
    expect(second.status).toBe('reserved')
  })

  it('rejects checking out an allocation that is not reserved', async () => {
    const allocation = await createAllocation({
      productId, clientId, staffId,
      checkoutDate: new Date('2026-09-01'),
      dueDate: new Date('2026-09-05'),
      priceCharged: 100,
    })
    await checkOutAllocation(allocation.id, {})

    await expect(checkOutAllocation(allocation.id, {})).rejects.toMatchObject({
      code: 'INVALID_ALLOCATION_TRANSITION',
    })
  })

  it('cancels a reserved allocation and frees the product', async () => {
    const allocation = await createAllocation({
      productId, clientId, staffId,
      checkoutDate: new Date('2026-09-01'),
      dueDate: new Date('2026-09-05'),
      priceCharged: 100,
    })
    await cancelAllocation(allocation.id)

    const again = await createAllocation({
      productId, clientId, staffId,
      checkoutDate: new Date('2026-09-01'),
      dueDate: new Date('2026-09-05'),
      priceCharged: 100,
    })
    expect(again.status).toBe('reserved')
  })

  it('is available when there is no allocation at all', async () => {
    expect(await getProductAvailability(productId, new Date('2026-09-01'))).toBe('available')
  })

  it('rejects allocating a product that is not active', async () => {
    const maintenanceProduct = await prisma.product.create({
      data: { locationId, name: 'Vestido em manutenção', category: 'festa', size: 'M', color: 'azul', rentalPrice: 100, depositAmount: 50, status: 'maintenance' },
    })

    await expect(
      createAllocation({
        productId: maintenanceProduct.id, clientId, staffId,
        checkoutDate: new Date('2026-09-01'),
        dueDate: new Date('2026-09-05'),
        priceCharged: 100,
      }),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_IN_CIRCULATION' })
  })

  it('CRITICAL: only one of two concurrent overlapping allocation attempts succeeds', async () => {
    const attempt = () =>
      createAllocation({
        productId, clientId, staffId,
        checkoutDate: new Date('2026-10-01'),
        dueDate: new Date('2026-10-05'),
        priceCharged: 100,
      })

    const results = await Promise.allSettled([attempt(), attempt()])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
  })
})
