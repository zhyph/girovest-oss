import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { hashPassword } from '../auth/passwords.js'
import { DEFAULT_CONTRACT_CLAUSES } from '../constants/defaultContractClauses.js'

export interface CompleteSetupInput {
  shopName: string
  shopAddress: string
  ownerName: string
  ownerLogin: string
  ownerPassword: string
}

export async function needsSetup(): Promise<boolean> {
  const count = await prisma.location.count()
  return count === 0
}

export async function completeSetup(
  input: CompleteSetupInput,
): Promise<{ locationId: string; staffId: string }> {
  if (!(await needsSetup())) {
    throw new AppError(ErrorCodes.SETUP_ALREADY_COMPLETE, 409, 'Setup has already been completed')
  }

  const location = await prisma.location.create({
    data: {
      name: input.shopName,
      address: input.shopAddress,
      contractClauses: {
        create: DEFAULT_CONTRACT_CLAUSES.map((text, index) => ({ text, sortOrder: index })),
      },
    },
  })

  const staff = await prisma.staff.create({
    data: {
      name: input.ownerName,
      login: input.ownerLogin,
      passwordHash: await hashPassword(input.ownerPassword),
      role: 'owner',
      locationId: location.id,
    },
  })

  return { locationId: location.id, staffId: staff.id }
}
