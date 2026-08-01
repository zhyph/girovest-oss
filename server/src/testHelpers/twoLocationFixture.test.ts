import { describe, it, expect, afterEach, vi } from 'vitest'
import { prisma } from '../db/client.js'
import { seedTwoLocations, expectNotFoundAcrossLocations, type TwoLocationFixture } from './twoLocationFixture.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

afterEach(async () => {
  await prisma.allocation.deleteMany()
  await prisma.client.deleteMany()
  await prisma.product.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('seedTwoLocations', () => {
  it('creates two fully independent locations with their own staff/product/client', async () => {
    const fixture = await seedTwoLocations()
    expect(fixture.locationA.id).not.toBe(fixture.locationB.id)
    expect(fixture.staffA.locationId).toBe(fixture.locationA.id)
    expect(fixture.staffB.locationId).toBe(fixture.locationB.id)
    expect(fixture.productA.locationId).toBe(fixture.locationA.id)
    expect(fixture.clientA.locationId).toBe(fixture.locationA.id)
    expect(fixture.productB.locationId).toBe(fixture.locationB.id)
    expect(fixture.clientB.locationId).toBe(fixture.locationB.id)
  })

  it('generates unique login values even when called multiple times with mocked time', async () => {
    // Mock Date.now() to a fixed value to simulate rapid successive calls
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T00:00:00Z'))

    try {
      // Call seedTwoLocations twice — if logins collided (Date.now() bug),
      // the second call would fail with P2002 unique constraint violation
      const fixture1 = await seedTwoLocations()
      const fixture2 = await seedTwoLocations()

      // If we get here, the unique constraint was not violated
      expect(fixture1.staffA.login).not.toBe(fixture2.staffA.login)
      expect(fixture1.staffB.login).not.toBe(fixture2.staffB.login)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('expectNotFoundAcrossLocations', () => {
  it('passes when the request throws a 404 AppError', async () => {
    await expectNotFoundAcrossLocations(async () => {
      throw new AppError(ErrorCodes.NOT_FOUND, 404, 'nope')
    })
  })

  it('fails when the request does not throw', async () => {
    await expect(
      expectNotFoundAcrossLocations(async () => 'unexpectedly succeeded'),
    ).rejects.toThrow()
  })
})
