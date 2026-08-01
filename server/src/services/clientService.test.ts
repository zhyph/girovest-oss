import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import {
  createClient,
  listClients,
  getClient,
  updateClient,
  deleteClient,
} from './clientService.js'

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
  await prisma.client.deleteMany()
  await prisma.product.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('clientService', () => {
  it('creates and fetches a client scoped to a location', async () => {
    const created = await createClient(locationId, {
      name: 'Maria Silva',
      phone: '11999990000',
      email: 'maria@example.com',
    })
    expect(created.locationId).toBe(locationId)

    const fetched = await getClient(locationId, created.id)
    expect(fetched.name).toBe('Maria Silva')
  })

  it('lists only clients belonging to the given location', async () => {
    await createClient(locationId, { name: 'Maria', phone: '1', email: 'a@example.com' })
    await createClient(otherLocationId, { name: 'Elsewhere', phone: '9', email: 'z@example.com' })

    const clients = await listClients(locationId)
    expect(clients).toHaveLength(1)
    expect(clients[0]!.name).toBe('Maria')
  })

  it('throws NOT_FOUND for a missing client', async () => {
    await expect(getClient(locationId, 'does-not-exist')).rejects.toThrow(AppError)
  })

  it('throws NOT_FOUND when fetching a client that belongs to another location', async () => {
    const created = await createClient(otherLocationId, { name: 'Elsewhere', phone: '9', email: 'z@example.com' })
    await expect(getClient(locationId, created.id)).rejects.toThrow(AppError)
  })

  it('updates a client', async () => {
    const created = await createClient(locationId, { name: 'Maria', phone: '1', email: 'a@example.com' })
    const updated = await updateClient(locationId, created.id, { phone: '2' })
    expect(updated.phone).toBe('2')
  })

  it('refuses to update a client belonging to another location', async () => {
    const created = await createClient(otherLocationId, { name: 'Elsewhere', phone: '9', email: 'z@example.com' })
    await expect(updateClient(locationId, created.id, { phone: '2' })).rejects.toThrow(AppError)
  })

  it('deletes a client with no allocation history', async () => {
    const created = await createClient(locationId, { name: 'Maria', phone: '1', email: 'a@example.com' })
    await deleteClient(locationId, created.id)
    await expect(getClient(locationId, created.id)).rejects.toThrow(AppError)
  })

  it('refuses to delete a client belonging to another location', async () => {
    const created = await createClient(otherLocationId, { name: 'Elsewhere', phone: '9', email: 'z@example.com' })
    await expect(deleteClient(locationId, created.id)).rejects.toThrow(AppError)
  })

  it('refuses to delete a client with allocation history', async () => {
    const staff = await prisma.staff.create({
      data: { name: 'S', login: 'staff1', passwordHash: 'x', role: 'staff', locationId },
    })
    const product = await prisma.product.create({
      data: {
        locationId,
        name: 'Vestido',
        category: 'festa',
        size: 'M',
        color: 'azul',
        rentalPrice: 100,
        depositAmount: 50,
      },
    })
    const client = await createClient(locationId, { name: 'Maria', phone: '1', email: 'a@example.com' })
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

    await expect(deleteClient(locationId, client.id)).rejects.toMatchObject({ code: 'CANNOT_DELETE_WITH_HISTORY' })
  })

  it('reports hasAllocationHistory false for a client with no allocations', async () => {
    const created = await createClient(locationId, { name: 'Maria', phone: '119', email: 'm@x.com' })
    expect(created.hasAllocationHistory).toBe(false)

    const fetched = await getClient(locationId, created.id)
    expect(fetched.hasAllocationHistory).toBe(false)

    const [listed] = await listClients(locationId)
    expect(listed.hasAllocationHistory).toBe(false)
  })

  it('reports hasAllocationHistory true once the client has an allocation, even after it is returned', async () => {
    const staff = await prisma.staff.create({
      data: { name: 'S', login: 'staff-hist', passwordHash: 'x', role: 'staff', locationId },
    })
    const product = await prisma.product.create({
      data: {
        locationId, name: 'Vestido', category: 'festa', size: 'M', color: 'azul',
        rentalPrice: 100, depositAmount: 50, photos: '[]',
      },
    })
    const client = await createClient(locationId, { name: 'Beatriz', phone: '129', email: 'b@x.com' })

    await prisma.allocation.create({
      data: {
        productId: product.id, clientId: client.id, staffId: staff.id,
        checkoutDate: new Date('2026-01-01'), dueDate: new Date('2026-01-05'),
        status: 'returned', actualReturnDate: new Date('2026-01-04'), priceCharged: 100,
      },
    })

    const fetched = await getClient(locationId, client.id)
    expect(fetched.hasAllocationHistory).toBe(true)

    const updated = await updateClient(locationId, client.id, { notes: 'updated' })
    expect(updated.hasAllocationHistory).toBe(true)
  })

  it('creates a client with identity documents and address lines', async () => {
    const created = await createClient(locationId, {
      name: 'Maria Silva',
      phone: '11999990000',
      email: 'maria@example.com',
      identityDocuments: [{ label: 'CPF', value: '123.456.789-00', maskKey: 'br-cpf' }],
      addressLines: [
        { label: 'Endereço', value: 'Rua Dr. Sebastião Pereira, 47', sortOrder: 0 },
        { label: 'Cidade', value: 'Piedade', sortOrder: 1 },
      ],
    })

    expect(created.identityDocuments).toEqual([
      expect.objectContaining({ label: 'CPF', value: '123.456.789-00', maskKey: 'br-cpf' }),
    ])
    expect(created.addressLines).toEqual([
      expect.objectContaining({ label: 'Endereço', value: 'Rua Dr. Sebastião Pereira, 47', sortOrder: 0 }),
      expect.objectContaining({ label: 'Cidade', value: 'Piedade', sortOrder: 1 }),
    ])
  })

  it('creates a client with no identity documents or address lines when omitted', async () => {
    const created = await createClient(locationId, { name: 'Joana', phone: '1', email: 'a@example.com' })
    expect(created.identityDocuments).toEqual([])
    expect(created.addressLines).toEqual([])
  })

  it('returns address lines ordered by sortOrder regardless of insertion order', async () => {
    const created = await createClient(locationId, {
      name: 'Maria',
      phone: '1',
      email: 'a@example.com',
      addressLines: [
        { label: 'Cidade', value: 'Piedade', sortOrder: 1 },
        { label: 'Endereço', value: 'Rua X', sortOrder: 0 },
      ],
    })
    const fetched = await getClient(locationId, created.id)
    expect(fetched.addressLines.map((line) => line.label)).toEqual(['Endereço', 'Cidade'])
  })

  it('replaces all identity documents on update when the field is provided', async () => {
    const created = await createClient(locationId, {
      name: 'Maria',
      phone: '1',
      email: 'a@example.com',
      identityDocuments: [{ label: 'CPF', value: 'old-value' }],
    })

    const updated = await updateClient(locationId, created.id, {
      identityDocuments: [{ label: 'CPF', value: 'new-value' }, { label: 'RG', value: '00.000.000-0' }],
    })

    expect(updated.identityDocuments).toHaveLength(2)
    expect(updated.identityDocuments.map((doc) => doc.value)).toEqual(['new-value', '00.000.000-0'])
  })

  it('clears all identity documents on update when given an empty array', async () => {
    const created = await createClient(locationId, {
      name: 'Maria',
      phone: '1',
      email: 'a@example.com',
      identityDocuments: [{ label: 'CPF', value: 'x' }],
    })

    const updated = await updateClient(locationId, created.id, { identityDocuments: [] })

    expect(updated.identityDocuments).toEqual([])
  })

  it('leaves identity documents untouched when the field is omitted from an update', async () => {
    const created = await createClient(locationId, {
      name: 'Maria',
      phone: '1',
      email: 'a@example.com',
      identityDocuments: [{ label: 'CPF', value: 'x' }],
    })

    const updated = await updateClient(locationId, created.id, { phone: '2' })

    expect(updated.identityDocuments).toEqual([expect.objectContaining({ label: 'CPF', value: 'x' })])
  })

  it('deletes identity documents and address lines when the client is deleted', async () => {
    const created = await createClient(locationId, {
      name: 'Maria',
      phone: '1',
      email: 'a@example.com',
      identityDocuments: [{ label: 'CPF', value: 'x' }],
      addressLines: [{ label: 'Cidade', value: 'Piedade', sortOrder: 0 }],
    })

    await deleteClient(locationId, created.id)

    const remainingDocs = await prisma.clientIdentityDocument.findMany({ where: { clientId: created.id } })
    const remainingLines = await prisma.clientAddressLine.findMany({ where: { clientId: created.id } })
    expect(remainingDocs).toEqual([])
    expect(remainingLines).toEqual([])
  })
})
