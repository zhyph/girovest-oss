import { expect } from 'vitest'
import { prisma } from '../db/client.js'
import { hashPassword } from '../auth/passwords.js'
import { AppError } from '../errors/AppError.js'

export async function seedTwoLocations() {
  const locationA = await prisma.location.create({ data: { name: 'Location A', address: 'A St' } })
  const locationB = await prisma.location.create({ data: { name: 'Location B', address: 'B St' } })

  const passwordHash = await hashPassword('fixture-password12')
  const staffA = await prisma.staff.create({
    data: { name: 'Staff A', login: `fixture-a-${Date.now()}`, passwordHash, role: 'owner', locationId: locationA.id },
  })
  const staffB = await prisma.staff.create({
    data: { name: 'Staff B', login: `fixture-b-${Date.now()}`, passwordHash, role: 'owner', locationId: locationB.id },
  })

  const productA = await prisma.product.create({
    data: {
      locationId: locationA.id,
      name: 'Product A',
      category: 'dress',
      size: 'M',
      color: 'red',
      rentalPrice: 100,
      depositAmount: 50,
    },
  })
  const productB = await prisma.product.create({
    data: {
      locationId: locationB.id,
      name: 'Product B',
      category: 'dress',
      size: 'M',
      color: 'blue',
      rentalPrice: 100,
      depositAmount: 50,
    },
  })

  const clientA = await prisma.client.create({
    data: { locationId: locationA.id, name: 'Client A', phone: '1', email: 'a@fixture.com' },
  })
  const clientB = await prisma.client.create({
    data: { locationId: locationB.id, name: 'Client B', phone: '2', email: 'b@fixture.com' },
  })

  return { locationA, locationB, staffA, staffB, productA, productB, clientA, clientB }
}

// Shared assertion for "staff at location A can't see/touch location B's
// resource" — every resource task in this plan reuses this exact check so
// the isolation contract is asserted identically everywhere.
export async function expectNotFoundAcrossLocations(request: () => Promise<unknown>): Promise<void> {
  await expect(request()).rejects.toMatchObject({
    constructor: AppError,
    status: 404,
  })
}
