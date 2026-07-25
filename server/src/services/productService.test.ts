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
} from './productService.js'

let locationId: string

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  locationId = location.id
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

    const fetched = await getProduct(created.id)
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
    expect(await listProducts()).toHaveLength(2)
  })

  it('throws NOT_FOUND for a missing product', async () => {
    await expect(getProduct('missing')).rejects.toThrow(AppError)
  })

  it('updates a product, including its photos', async () => {
    const created = await createProduct({
      locationId, name: 'A', category: 'festa', size: 'M', color: 'azul', rentalPrice: 1, depositAmount: 1,
    })
    const updated = await updateProduct(created.id, { photos: ['https://example.com/new.jpg'] })
    expect(updated.photos).toEqual(['https://example.com/new.jpg'])
  })

  it('deletes a product with no allocation history', async () => {
    const created = await createProduct({
      locationId, name: 'A', category: 'festa', size: 'M', color: 'azul', rentalPrice: 1, depositAmount: 1,
    })
    await deleteProduct(created.id)
    await expect(getProduct(created.id)).rejects.toThrow(AppError)
  })

  it('refuses to delete a product with allocation history', async () => {
    const staff = await prisma.staff.create({
      data: { name: 'S', login: 'staff-prod', passwordHash: 'x', role: 'staff', locationId },
    })
    const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@example.com' } })
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

    await expect(deleteProduct(product.id)).rejects.toMatchObject({ code: 'CANNOT_DELETE_WITH_HISTORY' })
  })

  it('reports availability derived from allocations, not the circulation status field', async () => {
    const staff = await prisma.staff.create({
      data: { name: 'S', login: 'staff-avail', passwordHash: 'x', role: 'staff', locationId },
    })
    const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@example.com' } })
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
    const fetched = await getProduct(product.id)
    expect(fetched.status).toBe('active')
    expect(fetched.availability).toBe('rented')

    const [listed] = await listProducts()
    expect(listed.availability).toBe('rented')
  })

  it('reports hasAllocationHistory, independent of availability', async () => {
    const staff = await prisma.staff.create({
      data: { name: 'S', login: 'staff-dhist', passwordHash: 'x', role: 'staff', locationId },
    })
    const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c2@example.com' } })
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

    const fetched = await getProduct(product.id)
    expect(fetched.hasAllocationHistory).toBe(true)
    // returned means it's no longer occupied — history and current availability are different axes
    expect(fetched.availability).toBe('available')

    const [listed] = await listProducts()
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
