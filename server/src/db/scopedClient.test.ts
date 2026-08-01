import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from './client.js'
import {
  scopedDb,
  LOCATION_SCOPED_MODELS,
  MANUALLY_SCOPED_MODELS,
  MODELS_WITH_LOCATION_ID_COLUMN,
} from './scopedClient.js'

afterEach(async () => {
  await prisma.allocation.deleteMany()
  await prisma.client.deleteMany()
  await prisma.product.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

async function seedTwoLocations() {
  const locationA = await prisma.location.create({ data: { name: 'A', address: 'A' } })
  const locationB = await prisma.location.create({ data: { name: 'B', address: 'B' } })
  return { locationA, locationB }
}

describe('scopedDb', () => {
  it('scopes findMany to the given locationId', async () => {
    const { locationA, locationB } = await seedTwoLocations()
    await prisma.client.create({ data: { name: 'A client', phone: '1', email: 'a@x.com', locationId: locationA.id } })
    await prisma.client.create({ data: { name: 'B client', phone: '2', email: 'b@x.com', locationId: locationB.id } })

    const dbA = scopedDb(locationA.id)
    const results = await dbA.client.findMany()
    expect(results).toHaveLength(1)
    expect(results[0]!.name).toBe('A client')
  })

  it('scopes create by injecting locationId into data', async () => {
    const { locationA } = await seedTwoLocations()
    const dbA = scopedDb(locationA.id)
    const created = await dbA.client.create({ data: { name: 'New', phone: '1', email: 'n@x.com' } as any })
    expect(created.locationId).toBe(locationA.id)
  })

  it('scopes findUnique so a cross-location id lookup returns null', async () => {
    const { locationA, locationB } = await seedTwoLocations()
    const client = await prisma.client.create({
      data: { name: 'B client', phone: '2', email: 'b@x.com', locationId: locationB.id },
    })
    const dbA = scopedDb(locationA.id)
    const result = await dbA.client.findUnique({ where: { id: client.id } })
    expect(result).toBeNull()
  })

  it('scopes deleteMany, updateMany, and count', async () => {
    const { locationA, locationB } = await seedTwoLocations()
    await prisma.client.create({ data: { name: 'A', phone: '1', email: 'a@x.com', locationId: locationA.id } })
    await prisma.client.create({ data: { name: 'B', phone: '2', email: 'b@x.com', locationId: locationB.id } })
    const dbA = scopedDb(locationA.id)

    expect(await dbA.client.count()).toBe(1)
    await dbA.client.updateMany({ data: { notes: 'touched' } })
    expect((await prisma.client.findMany({ where: { locationId: locationB.id } }))[0]!.notes).toBeNull()
    await dbA.client.deleteMany()
    expect(await prisma.client.count({ where: { locationId: locationB.id } })).toBe(1)
    expect(await prisma.client.count({ where: { locationId: locationA.id } })).toBe(0)
  })

  it('throws on an operation not in the deny-by-default allowlist for a scoped model', async () => {
    const { locationA } = await seedTwoLocations()
    const dbA = scopedDb(locationA.id)
    // groupBy is intentionally unhandled — this codebase never uses it
    // against Client/Product, so it must throw rather than pass through.
    await expect(
      (dbA.client as any).groupBy({ by: ['name'] }),
    ).rejects.toThrow(/unhandled operation/i)
  })

  it('passes through unmodified for a model with no locationId column at all', async () => {
    const { locationA } = await seedTwoLocations()
    const staff = await prisma.staff.create({
      data: { name: 'S', login: 'scoped-test-login', passwordHash: 'x', role: 'owner', locationId: locationA.id },
    })
    const dbA = scopedDb(locationA.id)
    const client = await dbA.client.create({ data: { name: 'C', phone: '1', email: 'c@x.com' } as any })
    // clientIdentityDocument has no locationId column and is not in either
    // registry list — it must pass through untouched, not throw.
    const doc = await dbA.clientIdentityDocument.create({
      data: { clientId: client.id, label: 'CPF', value: '123' },
    })
    expect(doc.id).toBeTruthy()
    await prisma.staff.delete({ where: { id: staff.id } })
  })

  it('throws for a model that carries locationId but is registered in neither list', () => {
    // Regression guard: if someone adds a seventh locationId-bearing model
    // to models.prisma without registering it anywhere, this must be loud.
    const registered = new Set([...LOCATION_SCOPED_MODELS, ...Object.keys(MANUALLY_SCOPED_MODELS)])
    for (const model of MODELS_WITH_LOCATION_ID_COLUMN) {
      expect(registered.has(model)).toBe(true)
    }
  })

  it('passes a MANUALLY_SCOPED_MODELS entry through completely unscoped', async () => {
    const { locationA, locationB } = await seedTwoLocations()
    await prisma.staff.create({
      data: { name: 'A staff', login: 'staff-a', passwordHash: 'x', role: 'owner', locationId: locationA.id },
    })
    await prisma.staff.create({
      data: { name: 'B staff', login: 'staff-b', passwordHash: 'x', role: 'owner', locationId: locationB.id },
    })
    const dbA = scopedDb(locationA.id)
    const results = await dbA.staff.findMany()
    // staff is in MANUALLY_SCOPED_MODELS — scopedDb must NOT filter it, proving
    // it's genuinely unscoped rather than accidentally scoped like client/product.
    expect(results).toHaveLength(2)
    expect(results.map((s) => s.name).sort()).toEqual(['A staff', 'B staff'])
  })

  it('throws the deny-by-default error for a model absent from both registries', async () => {
    const { locationA } = await seedTwoLocations()
    // Every real locationId-bearing model is registered somewhere by design,
    // so to exercise the deny-by-default throw itself we temporarily register
    // a model that carries no locationId column at all as if it did.
    const mutableRegistry = MODELS_WITH_LOCATION_ID_COLUMN as unknown as Set<string>
    mutableRegistry.add('allocation')
    try {
      const dbA = scopedDb(locationA.id)
      await expect((dbA as any).allocation.findMany()).rejects.toThrow(/registered in neither/i)
    } finally {
      mutableRegistry.delete('allocation')
    }
  })
})
