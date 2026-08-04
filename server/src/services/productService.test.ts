import { describe, it, expect, afterEach, beforeEach, beforeAll, afterAll } from 'vitest'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import {
  createProduct,
  listProducts,
  listProductsForLocation,
  getProduct,
  updateProduct,
  deleteProduct,
  listLeavingMaintenance,
} from './productService.js'

let locationId: string
let otherLocationId: string

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  locationId = location.id
  const other = await prisma.location.create({ data: { name: 'L2', address: 'A2' } })
  otherLocationId = other.id
})

afterEach(async () => {
  await prisma.allocation.deleteMany()
  await prisma.product.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.client.deleteMany()
  await prisma.location.deleteMany()
})

describe.sequential('productService', () => {
  it('creates a product with photos and reads it back as an array', async () => {
    const created = await createProduct({
      locationId,
      name: 'Vestido Longo',
      category: 'festa',
      size: 'M',
      color: 'vermelho',
      rentalPrice: 250,
      depositAmount: 100,
      photos: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    })

    expect(created.photos).toEqual(['https://example.com/a.jpg', 'https://example.com/b.jpg'])
    expect(created.status).toBe('active')

    const fetched = await getProduct(locationId, created.id)
    expect(fetched.photos).toEqual(['https://example.com/a.jpg', 'https://example.com/b.jpg'])
  })

  it('defaults to an empty photos array when none are given', async () => {
    const created = await createProduct({
      locationId,
      name: 'Vestido',
      category: 'festa',
      size: 'P',
      color: 'azul',
      rentalPrice: 200,
      depositAmount: 80,
    })
    expect(created.photos).toEqual([])
  })

  it('lists products', async () => {
    await createProduct({
      locationId, name: 'A', category: 'festa', size: 'M', color: 'azul', rentalPrice: 1, depositAmount: 1,
    })
    await createProduct({
      locationId, name: 'B', category: 'festa', size: 'M', color: 'azul', rentalPrice: 1, depositAmount: 1,
    })
    expect(await listProducts(locationId)).toHaveLength(2)
  })

  it('throws NOT_FOUND for a missing product', async () => {
    await expect(getProduct(locationId, 'missing')).rejects.toThrow(AppError)
  })

  it('throws NOT_FOUND when fetching a product that belongs to another location', async () => {
    const created = await createProduct({ locationId: otherLocationId, name: 'X', category: 'dress', size: 'M', color: 'red', rentalPrice: 10, depositAmount: 5 })
    await expect(getProduct(locationId, created.id)).rejects.toThrow(AppError)
  })

  it('lists only products belonging to the given location', async () => {
    await createProduct({ locationId, name: 'A', category: 'dress', size: 'M', color: 'red', rentalPrice: 10, depositAmount: 5 })
    await createProduct({ locationId: otherLocationId, name: 'B', category: 'dress', size: 'M', color: 'blue', rentalPrice: 10, depositAmount: 5 })
    const products = await listProducts(locationId)
    expect(products).toHaveLength(1)
    expect(products[0]!.name).toBe('A')
  })

  it('updates a product, including its photos', async () => {
    const created = await createProduct({
      locationId, name: 'A', category: 'festa', size: 'M', color: 'azul', rentalPrice: 1, depositAmount: 1,
    })
    const updated = await updateProduct(locationId, created.id, { photos: ['https://example.com/new.jpg'] })
    expect(updated.photos).toEqual(['https://example.com/new.jpg'])
  })

  it('refuses to update a product belonging to another location', async () => {
    const created = await createProduct({ locationId: otherLocationId, name: 'X', category: 'dress', size: 'M', color: 'red', rentalPrice: 10, depositAmount: 5 })
    await expect(updateProduct(locationId, created.id, { color: 'green' })).rejects.toThrow(AppError)
  })

  it('deletes a product with no allocation history', async () => {
    const created = await createProduct({
      locationId, name: 'A', category: 'festa', size: 'M', color: 'azul', rentalPrice: 1, depositAmount: 1,
    })
    await deleteProduct(locationId, created.id)
    await expect(getProduct(locationId, created.id)).rejects.toThrow(AppError)
  })

  it('refuses to delete a product belonging to another location', async () => {
    const created = await createProduct({ locationId: otherLocationId, name: 'X', category: 'dress', size: 'M', color: 'red', rentalPrice: 10, depositAmount: 5 })
    await expect(deleteProduct(locationId, created.id)).rejects.toThrow(AppError)
  })

  it('refuses to delete a product with allocation history', async () => {
    const staff = await prisma.staff.create({
      data: { name: 'S', login: 'staff-prod', passwordHash: 'x', role: 'staff', locationId },
    })
    const client = await prisma.client.create({ data: { locationId, name: 'C', phone: '1', email: 'c@example.com' } })
    const product = await createProduct({
      locationId, name: 'A', category: 'festa', size: 'M', color: 'azul', rentalPrice: 1, depositAmount: 1,
    })
    await prisma.allocation.create({
      data: {
        productId: product.id,
        clientId: client.id,
        staffId: staff.id,
        checkoutDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-05'),
        status: 'reserved',
        priceCharged: 1,
      },
    })

    await expect(deleteProduct(locationId, product.id)).rejects.toMatchObject({ code: 'CANNOT_DELETE_WITH_HISTORY' })
  })

  it('reports availability derived from allocations, not the circulation status field', async () => {
    const staff = await prisma.staff.create({
      data: { name: 'S', login: 'staff-avail', passwordHash: 'x', role: 'staff', locationId },
    })
    const client = await prisma.client.create({ data: { locationId, name: 'C', phone: '1', email: 'c@example.com' } })
    const product = await createProduct({
      locationId, name: 'A', category: 'festa', size: 'M', color: 'azul', rentalPrice: 1, depositAmount: 1,
    })

    expect(product.availability).toBe('available')

    await prisma.allocation.create({
      data: {
        productId: product.id,
        clientId: client.id,
        staffId: staff.id,
        checkoutDate: new Date('2026-01-01'),
        dueDate: new Date('2026-01-05'),
        status: 'checked_out',
        priceCharged: 1,
      },
    })

    // The product's own circulation status never changes on checkout — this
    // is exactly the field the Products list used to badge, which is why it
    // always read "Disponível" no matter what.
    const fetched = await getProduct(locationId, product.id)
    expect(fetched.status).toBe('active')
    expect(fetched.availability).toBe('rented')

    const [listed] = await listProducts(locationId)
    expect(listed.availability).toBe('rented')
  })

  it('CRITICAL: badges a dress taken out early as rented today, not available until its planned checkout date', async () => {
    const staff = await prisma.staff.create({
      data: { name: 'S', login: 'staff-early', passwordHash: 'x', role: 'staff', locationId },
    })
    const client = await prisma.client.create({ data: { locationId, name: 'C', phone: '1', email: 'c3@example.com' } })
    const product = await createProduct({
      locationId, name: 'A', category: 'festa', size: 'M', color: 'azul', rentalPrice: 1, depositAmount: 1,
    })

    // Planned pickup is far in the future, but the dress physically left the
    // store yesterday after a confirmed early check-out.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await prisma.allocation.create({
      data: {
        productId: product.id,
        clientId: client.id,
        staffId: staff.id,
        checkoutDate: new Date('2099-01-10'),
        actualCheckoutDate: yesterday,
        dueDate: new Date('2099-01-15'),
        status: 'checked_out',
        priceCharged: 1,
      },
    })

    expect((await getProduct(locationId, product.id)).availability).toBe('rented')
    const [listed] = await listProducts(locationId)
    expect(listed.availability).toBe('rented')
  })

  it('reports hasAllocationHistory, independent of availability', async () => {
    const staff = await prisma.staff.create({
      data: { name: 'S', login: 'staff-dhist', passwordHash: 'x', role: 'staff', locationId },
    })
    const client = await prisma.client.create({ data: { locationId, name: 'C', phone: '1', email: 'c2@example.com' } })
    const product = await createProduct({
      locationId, name: 'A', category: 'festa', size: 'M', color: 'azul', rentalPrice: 1, depositAmount: 1,
    })

    expect(product.hasAllocationHistory).toBe(false)

    await prisma.allocation.create({
      data: {
        productId: product.id, clientId: client.id, staffId: staff.id,
        checkoutDate: new Date('2026-01-01'), dueDate: new Date('2026-01-05'),
        status: 'returned', actualReturnDate: new Date('2026-01-04'), priceCharged: 1,
      },
    })

    const fetched = await getProduct(locationId, product.id)
    expect(fetched.hasAllocationHistory).toBe(true)
    // returned means it's no longer occupied — history and current availability are different axes
    expect(fetched.availability).toBe('available')

    const [listed] = await listProducts(locationId)
    expect(listed.hasAllocationHistory).toBe(true)
  })
})

describe('listProductsForLocation', () => {
  it('returns only that location\'s products, newest first', async () => {
    const locationA = await prisma.location.create({ data: { name: 'A', address: 'X' } })
    const locationB = await prisma.location.create({ data: { name: 'B', address: 'Y' } })
    const p1 = await createProduct({ locationId: locationA.id, name: 'First', category: 'c', size: 's', color: 'c', rentalPrice: 1, depositAmount: 1 })
    const p2 = await createProduct({ locationId: locationA.id, name: 'Second', category: 'c', size: 's', color: 'c', rentalPrice: 1, depositAmount: 1 })
    await createProduct({ locationId: locationB.id, name: 'Other location', category: 'c', size: 's', color: 'c', rentalPrice: 1, depositAmount: 1 })

    const result = await listProductsForLocation(locationA.id, {})
    expect(result.map((p) => p.id)).toEqual([p2.id, p1.id])
  })

  it('filters by search substring across name/category/color', async () => {
    const location = await prisma.location.create({ data: { name: 'C', address: 'Z' } })
    await createProduct({ locationId: location.id, name: 'Vestido Azul', category: 'festa', size: 'M', color: 'azul', rentalPrice: 1, depositAmount: 1 })
    await createProduct({ locationId: location.id, name: 'Vestido Verde', category: 'gala', size: 'M', color: 'verde', rentalPrice: 1, depositAmount: 1 })

    const result = await listProductsForLocation(location.id, { search: 'azul' })
    expect(result.map((p) => p.name)).toEqual(['Vestido Azul'])
  })
})

describe.sequential('maintenance window across shops', () => {
  it("does not apply one shop's cleaning window to another shop's pieces", async () => {
    // The maintenance buffer is a per-shop setting. availabilityByProductId
    // groups its batch lookup by buffer value rather than by location (an
    // optimization, not a location filter), so this exercises each shop's
    // own listProducts() call to confirm a long cleaning window configured
    // by one shop never leaks onto another shop's pieces.
    const slowShop = await prisma.location.create({
      data: { name: 'Higieniza devagar', address: 'B', maintenanceBufferDays: 10 },
    })
    const staff = await prisma.staff.create({
      data: { name: 'S', login: `s-${Date.now()}`, passwordHash: 'x', role: 'staff', locationId },
    })
    const client = await prisma.client.create({ data: { locationId, name: 'C', phone: '1', email: 'c@example.com' } })

    const makeReturnedProduct = async (ownerLocationId: string) => {
      const product = await prisma.product.create({
        data: {
          locationId: ownerLocationId, name: 'Vestido', category: 'Festa', size: 'M', color: 'Azul',
          rentalPrice: 100, depositAmount: 50,
        },
      })
      await prisma.allocation.create({
        data: {
          productId: product.id, clientId: client.id, staffId: staff.id,
          checkoutDate: new Date('2020-01-01'), dueDate: new Date('2020-01-05'),
          // Yesterday: the cleaning window opens the day AFTER the return, which
          // is what keeps a buffer of 0 identical to the old "free immediately".
          actualReturnDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
          status: 'returned', priceCharged: 100,
        },
      })
      return product.id
    }

    // Both came back yesterday; only the slow shop configured a window.
    const noBufferProductId = await makeReturnedProduct(locationId)
    const slowShopProductId = await makeReturnedProduct(slowShop.id)

    const [noBufferListing] = await listProducts(locationId)
    const [slowShopListing] = await listProducts(slowShop.id)

    expect(noBufferListing?.id).toBe(noBufferProductId)
    expect(noBufferListing?.availability).toBe('available')
    expect(slowShopListing?.id).toBe(slowShopProductId)
    expect(slowShopListing?.availability).toBe('maintenance')
  })
})

describe.sequential('listLeavingMaintenance', () => {
  // Fixed instant so the assertions never depend on the day the suite runs.
  const ASOF = new Date('2026-08-10T12:00:00.000Z')

  async function returnedProduct(ownerLocationId: string, name: string, returnedOn: string) {
    const staff = await prisma.staff.create({
      data: {
        name: 'S', login: `s-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'staff',
        locationId: ownerLocationId,
      },
    })
    const client = await prisma.client.create({
      data: { locationId: ownerLocationId, name: 'C', phone: '1', email: 'c@example.com' },
    })
    const product = await prisma.product.create({
      data: {
        locationId: ownerLocationId, name, category: 'Festa', size: 'M', color: 'Azul',
        rentalPrice: 100, depositAmount: 50,
      },
    })
    await prisma.allocation.create({
      data: {
        productId: product.id, clientId: client.id, staffId: staff.id,
        checkoutDate: new Date('2026-07-01'), dueDate: new Date('2026-07-05'),
        actualReturnDate: new Date(returnedOn), status: 'returned', priceCharged: 100,
      },
    })
    return product.id
  }

  it('lists only the pieces whose cleaning window closes inside the next two days', async () => {
    // A ten-day window: a piece back on Aug 1 is free again on Aug 12
    // (window Aug 2–11), one back on Aug 5 not until Aug 16.
    await prisma.location.update({ where: { id: locationId }, data: { maintenanceBufferDays: 10 } })
    const almostReady = await returnedProduct(locationId, 'Quase pronto', '2026-08-01')
    await returnedProduct(locationId, 'Ainda longe', '2026-08-05')
    // Never rented: available, not in any cleaning window.
    await prisma.product.create({
      data: {
        locationId, name: 'Nunca alugado', category: 'Festa', size: 'P', color: 'Verde',
        rentalPrice: 100, depositAmount: 50,
      },
    })

    const result = await listLeavingMaintenance(locationId, 2, ASOF)

    expect(result.count).toBe(1)
    expect(result.items).toEqual([{ id: almostReady, name: 'Quase pronto', availableOn: '2026-08-12' }])
  })

  it('returns nothing when the shop configured no cleaning window at all', async () => {
    // maintenanceBufferDays defaults to 0 on the fixture location.
    await returnedProduct(locationId, 'Voltou ontem', '2026-08-09')

    expect(await listLeavingMaintenance(locationId, 2, ASOF)).toEqual({ count: 0, items: [] })
  })

  it("never reports another shop's pieces", async () => {
    await prisma.location.update({ where: { id: locationId }, data: { maintenanceBufferDays: 10 } })
    await prisma.location.update({ where: { id: otherLocationId }, data: { maintenanceBufferDays: 10 } })
    await returnedProduct(otherLocationId, 'Peça da outra loja', '2026-08-01')

    expect(await listLeavingMaintenance(locationId, 2, ASOF)).toEqual({ count: 0, items: [] })
  })

  it('ignores a piece a customer is still holding, whatever an older cleaning window says', async () => {
    await prisma.location.update({ where: { id: locationId }, data: { maintenanceBufferDays: 10 } })
    const productId = await returnedProduct(locationId, 'Saiu de novo', '2026-08-01')
    const staff = await prisma.staff.findFirstOrThrow({ where: { locationId } })
    const client = await prisma.client.findFirstOrThrow({ where: { locationId } })
    // Out again today: a dress that is not in the shop cannot be "coming out
    // of cleaning", even though its previous return's window closes tomorrow.
    await prisma.allocation.create({
      data: {
        productId, clientId: client.id, staffId: staff.id,
        checkoutDate: new Date('2026-08-09'), dueDate: new Date('2026-08-20'),
        status: 'checked_out', priceCharged: 100,
      },
    })

    expect(await listLeavingMaintenance(locationId, 2, ASOF)).toEqual({ count: 0, items: [] })
  })

  it('leaves retired and maintenance-flagged pieces out of the catalogue count', async () => {
    await prisma.location.update({ where: { id: locationId }, data: { maintenanceBufferDays: 10 } })
    const retiredId = await returnedProduct(locationId, 'Aposentado', '2026-08-01')
    await prisma.product.update({ where: { id: retiredId }, data: { status: 'retired' } })

    expect(await listLeavingMaintenance(locationId, 2, ASOF)).toEqual({ count: 0, items: [] })
  })
})
