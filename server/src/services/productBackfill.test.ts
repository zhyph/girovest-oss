import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { runProductBackfill } from './productBackfill.js'

afterEach(async () => {
  await prisma.product.deleteMany()
  await prisma.location.deleteMany()
})

async function makeProduct(locationId: string, name: string, createdAt: Date, code: number | null = null) {
  return prisma.product.create({
    data: {
      locationId,
      name,
      code,
      category: 'Festa',
      size: 'M',
      color: 'Azul',
      rentalPrice: 100,
      depositAmount: 50,
      createdAt,
    },
  })
}

describe.sequential('runProductBackfill', () => {
  it('numbers pre-existing pieces from 1 in the order the shop acquired them', async () => {
    const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
    const second = await makeProduct(location.id, 'Segundo', new Date('2026-02-01'))
    const first = await makeProduct(location.id, 'Primeiro', new Date('2026-01-01'))

    await runProductBackfill()

    const rows = await prisma.product.findMany({ where: { locationId: location.id }, orderBy: { code: 'asc' } })
    expect(rows.map((row) => [row.id, row.code])).toEqual([
      [first.id, 1],
      [second.id, 2],
    ])
  })

  it('numbers each shop independently, both starting at 1', async () => {
    const one = await prisma.location.create({ data: { name: 'L1', address: 'A' } })
    const two = await prisma.location.create({ data: { name: 'L2', address: 'B' } })
    await makeProduct(one.id, 'Da loja 1', new Date('2026-01-01'))
    await makeProduct(two.id, 'Da loja 2', new Date('2026-01-02'))

    await runProductBackfill()

    const rows = await prisma.product.findMany({ orderBy: { name: 'asc' } })
    expect(rows.map((row) => row.code)).toEqual([1, 1])
  })

  it('continues after the highest existing code instead of colliding with it', async () => {
    const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
    await makeProduct(location.id, 'Já numerado', new Date('2026-01-01'), 7)
    const unnumbered = await makeProduct(location.id, 'Sem código', new Date('2026-01-02'))

    await runProductBackfill()

    const row = await prisma.product.findUniqueOrThrow({ where: { id: unnumbered.id } })
    expect(row.code).toBe(8)
  })

  it('is idempotent — a second boot renumbers nothing', async () => {
    const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
    await makeProduct(location.id, 'Primeiro', new Date('2026-01-01'))
    await makeProduct(location.id, 'Segundo', new Date('2026-01-02'))

    await runProductBackfill()
    const afterFirstRun = await prisma.product.findMany({ orderBy: { name: 'asc' }, select: { id: true, code: true } })
    await runProductBackfill()
    const afterSecondRun = await prisma.product.findMany({ orderBy: { name: 'asc' }, select: { id: true, code: true } })

    expect(afterSecondRun).toEqual(afterFirstRun)
  })

  it('does nothing at all on an empty catalogue', async () => {
    await expect(runProductBackfill()).resolves.toBeUndefined()
  })
})
