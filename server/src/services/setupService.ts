import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { hashPassword } from '../auth/passwords.js'
import { generateRecoveryCode, hashRecoveryCode } from '../auth/recoveryCodes.js'
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
): Promise<{ locationId: string; staffId: string; recoveryCode: string }> {
  const useSerializable = process.env.DB_PROVIDER === 'postgresql'

  // Generated outside the transaction: it's pure crypto/hashing, no DB
  // access, and the plaintext only ever needs to exist in memory long enough
  // to hash it and hand it back in the response below.
  const recoveryCode = generateRecoveryCode()
  const recoveryCodeHash = await hashRecoveryCode(recoveryCode)

  const { locationId, staffId } = await prisma.$transaction(
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
          // Normalised on the way in, matching how every later lookup reads
          // it — see normalizeLogin in authRoutes. A name chosen with a stray
          // space here is an account that can never be logged into again.
          login: input.ownerLogin.trim().toLowerCase(),
          passwordHash: await hashPassword(input.ownerPassword),
          role: 'owner',
          locationId: location.id,
          recoveryCodeHash,
        },
      })

      return { locationId: location.id, staffId: staff.id }
    },
    useSerializable ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } : undefined,
  )

  // Only ever returned this once: the setup wizard's own screen is the sole
  // place a plaintext recovery code is shown. Nothing server-side stores it
  // or can produce it again -- losing it means the next reset has to mint
  // (and show, once) a fresh one, exactly the flow /api/auth/recover uses.
  return { locationId, staffId, recoveryCode }
}
