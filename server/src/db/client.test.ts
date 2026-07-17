import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from './client.js'

describe('prisma client smoke test', () => {
  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('can create and read back a Location', async () => {
    const created = await prisma.location.create({
      data: { name: 'Loja Centro', address: 'Rua Principal, 100' },
    })

    expect(created.locale).toBe('pt-BR')

    const found = await prisma.location.findUnique({ where: { id: created.id } })
    expect(found?.name).toBe('Loja Centro')

    await prisma.location.delete({ where: { id: created.id } })
  })
})
