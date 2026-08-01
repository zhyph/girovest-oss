import { Prisma } from '../generated/prisma/client.js'
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
  // Optional for older clients whose wizard predates the choice; those keep
  // the schema default ('lan'), same as every pre-upgrade install.
  connectivityMode?: 'lan' | 'relay'
}

export async function needsSetup(): Promise<boolean> {
  const count = await prisma.location.count()
  return count === 0
}

export async function completeSetup(
  input: CompleteSetupInput,
): Promise<{ locationId: string; staffId: string }> {
  const useSerializable = process.env.DB_PROVIDER === 'postgresql'

  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.location.count()
      if (existing > 0) {
        throw new AppError(ErrorCodes.SETUP_ALREADY_COMPLETE, 409, 'Setup has already been completed')
      }

      const location = await tx.location.create({
        data: {
          name: input.shopName,
          address: input.shopAddress,
          connectivityMode: input.connectivityMode ?? 'lan',
          contractClauses: {
            create: DEFAULT_CONTRACT_CLAUSES.map((text, index) => ({ text, sortOrder: index })),
          },
        },
      })

      const staff = await tx.staff.create({
        data: {
          name: input.ownerName,
          login: input.ownerLogin,
          passwordHash: await hashPassword(input.ownerPassword),
          role: 'owner',
          locationId: location.id,
        },
      })

      return { locationId: location.id, staffId: staff.id }
    },
    useSerializable ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } : undefined,
  )
}
