import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { completeSetup } from './setupService.js'
import { DEFAULT_CONTRACT_CLAUSES } from '../constants/defaultContractClauses.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

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

  it('stores the chosen connectivityMode on the new Location', async () => {
    const result = await completeSetup({
      shopName: 'Priscila Moda Festa',
      shopAddress: 'Rua Dr. Sebastião Pereira, 47',
      ownerName: 'Priscila',
      ownerLogin: 'priscila',
      ownerPassword: 'senha12345',
      connectivityMode: 'relay',
    })

    const location = await prisma.location.findUnique({ where: { id: result.locationId } })
    expect(location?.connectivityMode).toBe('relay')
  })

  it('only one of two concurrent completeSetup calls succeeds', async () => {
    const input = {
      shopName: 'Shop', shopAddress: 'Addr', ownerName: 'Owner',
      ownerLogin: `race-${Date.now()}`, ownerPassword: 'password123',
    }
    const results = await Promise.allSettled([completeSetup(input), completeSetup({ ...input, ownerLogin: `${input.ownerLogin}-2` })])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    expect(fulfilled).toHaveLength(1)
    const locationCount = await prisma.location.count()
    expect(locationCount).toBe(1)

    // The loser must fail cleanly with the expected 409, not crash with
    // something like a transaction timeout (which would also leave exactly
    // one fulfilled promise, but for the wrong reason).
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(AppError)
    expect((rejected[0].reason as AppError).code).toBe(ErrorCodes.SETUP_ALREADY_COMPLETE)
    expect((rejected[0].reason as AppError).status).toBe(409)
  })
})
