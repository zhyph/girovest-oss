import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { seedTwoLocations, expectNotFoundAcrossLocations } from './twoLocationFixture.js'
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
