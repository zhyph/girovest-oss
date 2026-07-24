import crypto from 'crypto'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

const TOKEN_TTL_MS = 15 * 60 * 1000

export async function issueSigningToken(
  contractId: string,
  locationId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const contract = await prisma.contract.findUnique({ where: { id: contractId } })
  // A contract belonging to another location reads as NOT_FOUND, matching
  // getContract/cancelContract's same rule — never confirm existence of a
  // contract ID outside the caller's own location.
  if (!contract || contract.locationId !== locationId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Contract ${contractId} not found`)
  }

  // "Staff can generate a fresh token at any time, invalidating the
  // previous one" — a Contract only ever has one live unclaimed token, so
  // reissuing replaces whatever unclaimed one was there before. Scoped to
  // usedAt: null deliberately: submitSignature claims a token (sets
  // usedAt) and only afterward reads it back by contractId to update the
  // Contract — deleting an already-claimed row out from under that second
  // read would throw a raw (non-AppError) Prisma error and leave the
  // Contract permanently unsigned despite the phone's submission having
  // already been accepted.
  await prisma.signingToken.deleteMany({ where: { contractId, usedAt: null } })

  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)
  await prisma.signingToken.create({ data: { token, contractId, expiresAt } })
  return { token, expiresAt }
}

export async function checkTokenValidity(token: string): Promise<'valid' | 'expired' | 'used' | 'not_found'> {
  const signingToken = await prisma.signingToken.findUnique({ where: { token } })
  if (!signingToken) return 'not_found'
  if (signingToken.usedAt) return 'used'
  if (signingToken.expiresAt.getTime() < Date.now()) return 'expired'
  return 'valid'
}

export async function submitSignature(token: string, signatureImage: string): Promise<void> {
  const now = new Date()

  // Claim the token atomically: the WHERE clause (usedAt: null AND
  // expiresAt in the future) only matches an actually-valid, unclaimed
  // token, and the update itself is what claims it — so two concurrent
  // submits with the same token can never both succeed. A plain
  // check-then-update (read validity, then separately write usedAt) would
  // leave a window where both requests read "valid" before either writes,
  // letting both go on to overwrite the Contract's signature.
  const result = await prisma.signingToken.updateMany({
    where: { token, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  })

  if (result.count === 0) {
    const status = await checkTokenValidity(token)
    if (status === 'not_found') {
      throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Signing token not found')
    }
    throw new AppError(ErrorCodes.SIGNING_TOKEN_INVALID, 410, `Signing token is ${status}`)
  }

  const signingToken = await prisma.signingToken.findUniqueOrThrow({ where: { token } })
  await prisma.contract.update({
    where: { id: signingToken.contractId },
    data: { signatureStatus: 'signed', signatureImage, signedAt: now },
  })
}
