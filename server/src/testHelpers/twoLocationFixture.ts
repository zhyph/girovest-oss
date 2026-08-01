import { randomUUID } from 'crypto'
import { expect } from 'vitest'
import { prisma } from '../db/client.js'
import { scopedDb } from '../db/scopedClient.js'
import { hashPassword } from '../auth/passwords.js'
import { AppError } from '../errors/AppError.js'

export async function seedTwoLocations() {
  const locationA = await prisma.location.create({ data: { name: 'Location A', address: 'A St' } })
  const locationB = await prisma.location.create({ data: { name: 'Location B', address: 'B St' } })

  const passwordHash = await hashPassword('fixture-password12')
  const staffA = await prisma.staff.create({
    data: { name: 'Staff A', login: `fixture-a-${randomUUID().slice(0, 8)}`, passwordHash, role: 'owner', locationId: locationA.id },
  })
  const staffB = await prisma.staff.create({
    data: { name: 'Staff B', login: `fixture-b-${randomUUID().slice(0, 8)}`, passwordHash, role: 'owner', locationId: locationB.id },
  })

  // `as any` on `data`: scopedDb injects `locationId` into the write at
  // runtime (see scopedClient.ts), but its extended client type still
  // reflects Prisma's generated input type, which requires `locationId` —
  // the same cast clientService.ts's own scopedDb(...).client.create uses.
  const productA = await scopedDb(locationA.id).product.create({
    data: {
      name: 'Product A',
      category: 'dress',
      size: 'M',
      color: 'red',
      rentalPrice: 100,
      depositAmount: 50,
    } as any,
  })
  const productB = await scopedDb(locationB.id).product.create({
    data: {
      name: 'Product B',
      category: 'dress',
      size: 'M',
      color: 'blue',
      rentalPrice: 100,
      depositAmount: 50,
    } as any,
  })

  const clientA = await scopedDb(locationA.id).client.create({
    data: { name: 'Client A', phone: '1', email: 'a@fixture.com' } as any,
  })
  const clientB = await scopedDb(locationB.id).client.create({
    data: { name: 'Client B', phone: '2', email: 'b@fixture.com' } as any,
  })

  return { locationA, locationB, staffA, staffB, productA, productB, clientA, clientB }
}

export type TwoLocationFixture = Awaited<ReturnType<typeof seedTwoLocations>>

// Shared assertion for "staff at location A can't see/touch location B's
// resource" — every resource task in this plan reuses this exact check so
// the isolation contract is asserted identically everywhere.
export async function expectNotFoundAcrossLocations(request: () => Promise<unknown>): Promise<void> {
  await expect(request()).rejects.toMatchObject({
    constructor: AppError,
    status: 404,
  })
}
