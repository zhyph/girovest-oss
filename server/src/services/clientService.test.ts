import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import {
  createClient,
  listClients,
  getClient,
  updateClient,
  deleteClient,
} from './clientService.js'

afterEach(async () => {
  await prisma.allocation.deleteMany()
  await prisma.client.deleteMany()
  await prisma.product.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('clientService', () => {
  it('creates and fetches a client', async () => {
    const created = await createClient({
      name: 'Maria Silva',
      phone: '11999990000',
      email: 'maria@example.com',
    })

    const fetched = await getClient(created.id)
    expect(fetched.name).toBe('Maria Silva')
  })

  it('lists clients', async () => {
    await createClient({ name: 'Maria', phone: '1', email: 'a@example.com' })
    await createClient({ name: 'Joana', phone: '2', email: 'b@example.com' })

    const clients = await listClients()
    expect(clients).toHaveLength(2)
  })

  it('throws NOT_FOUND for a missing client', async () => {
    await expect(getClient('does-not-exist')).rejects.toThrow(AppError)
  })

  it('updates a client', async () => {
    const created = await createClient({ name: 'Maria', phone: '1', email: 'a@example.com' })
    const updated = await updateClient(created.id, { phone: '2' })
    expect(updated.phone).toBe('2')
  })

  it('deletes a client with no allocation history', async () => {
    const created = await createClient({ name: 'Maria', phone: '1', email: 'a@example.com' })
    await deleteClient(created.id)
    await expect(getClient(created.id)).rejects.toThrow(AppError)
  })

  it('refuses to delete a client with allocation history', async () => {
    const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
    const staff = await prisma.staff.create({
      data: { name: 'S', login: 'staff1', passwordHash: 'x', role: 'staff', locationId: location.id },
    })
    const product = await prisma.product.create({
      data: {
        locationId: location.id,
        name: 'Vestido',
        category: 'festa',
        size: 'M',
        color: 'azul',
        rentalPrice: 100,
        depositAmount: 50,
      },
    })
    const client = await createClient({ name: 'Maria', phone: '1', email: 'a@example.com' })
    await prisma.allocation.create({
      data: {
        productId: product.id,
        clientId: client.id,
        staffId: staff.id,
        checkoutDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-05'),
        status: 'reserved',
        priceCharged: 100,
      },
    })

    await expect(deleteClient(client.id)).rejects.toMatchObject({ code: 'CANNOT_DELETE_WITH_HISTORY' })
  })

  it('reports hasAllocationHistory false for a client with no allocations', async () => {
    const created = await createClient({ name: 'Maria', phone: '119', email: 'm@x.com' })
    expect(created.hasAllocationHistory).toBe(false)

    const fetched = await getClient(created.id)
    expect(fetched.hasAllocationHistory).toBe(false)

    const [listed] = await listClients()
    expect(listed.hasAllocationHistory).toBe(false)
  })

  it('reports hasAllocationHistory true once the client has an allocation, even after it is returned', async () => {
    const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
    const staff = await prisma.staff.create({
      data: { name: 'S', login: 'staff-hist', passwordHash: 'x', role: 'staff', locationId: location.id },
    })
    const product = await prisma.product.create({
      data: {
        locationId: location.id, name: 'Vestido', category: 'festa', size: 'M', color: 'azul',
        rentalPrice: 100, depositAmount: 50, photos: '[]',
      },
    })
    const client = await createClient({ name: 'Beatriz', phone: '129', email: 'b@x.com' })

    await prisma.allocation.create({
      data: {
        productId: product.id, clientId: client.id, staffId: staff.id,
        checkoutDate: new Date('2026-01-01'), dueDate: new Date('2026-01-05'),
        status: 'returned', actualReturnDate: new Date('2026-01-04'), priceCharged: 100,
      },
    })

    const fetched = await getClient(client.id)
    expect(fetched.hasAllocationHistory).toBe(true)

    const updated = await updateClient(client.id, { notes: 'updated' })
    expect(updated.hasAllocationHistory).toBe(true)
  })
})
