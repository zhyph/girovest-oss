import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { completeSetup } from './setupService.js'
import { DEFAULT_CONTRACT_CLAUSES } from '../constants/defaultContractClauses.js'

afterEach(async () => {
  await prisma.locationContractClause.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('completeSetup', () => {
  it('seeds the default contract clauses for the new Location, in order', async () => {
    const result = await completeSetup({
      shopName: 'Priscila Moda Festa',
      shopAddress: 'Rua Dr. Sebastião Pereira, 47',
      ownerName: 'Priscila',
      ownerLogin: 'priscila',
      ownerPassword: 'senha12345',
    })

    const clauses = await prisma.locationContractClause.findMany({
      where: { locationId: result.locationId },
      orderBy: { sortOrder: 'asc' },
    })

    expect(clauses.map((clause) => clause.text)).toEqual(DEFAULT_CONTRACT_CLAUSES)
    expect(clauses.map((clause) => clause.sortOrder)).toEqual(DEFAULT_CONTRACT_CLAUSES.map((_, index) => index))
  })
})
