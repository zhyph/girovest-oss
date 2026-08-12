import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import type { VerifiedStaffToken } from './jwt.js'
import { shouldRenewToken, signStaffToken, unsafeDecodeStaffToken, verifyStaffToken } from './jwt.js'

export const RENEWED_TOKEN_HEADER = 'X-Renewed-Token'

// Paths the client polls by itself, with no user behind them. Renewing on these
// would make an unattended-but-open terminal immortal, which is exactly what
// "an idle session still expires" forbids: /api/products/events/ticket is
// re-minted every ~4 minutes for as long as the app window is open.
// Matched against `req.baseUrl + req.path`, because requireAuth is mounted with
// `productsRouter.use(...)` and `req.path` alone would be router-relative.
export const RENEWAL_EXCLUDED_PATHS = new Set(['/api/products/events/ticket'])

// The path allowlist above can only cover URLs that are ALWAYS unattended. Some
// URLs are both: GET /api/contracts/:id is what opening a contract produces and
// what SignRemotelyModal polls every 3 seconds for as long as it is left open —
// which is until someone closes it, possibly the next morning. The server has
// no way to tell those two apart, so the client labels its own timer-driven
// traffic with this header and we skip renewal when we see it. Trusting the
// client here is safe: the header can only ever shorten a session, never
// extend one.
export const BACKGROUND_REQUEST_HEADER = 'X-Background-Request'

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.header('authorization')
  if (!header?.startsWith('Bearer ')) {
    console.warn(`[auth] requireAuth rejected ${req.method} ${req.originalUrl}: missing/malformed Authorization header`)
    throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Missing or malformed Authorization header')
  }

  const token = header.slice('Bearer '.length)
  let payload: VerifiedStaffToken
  try {
    payload = verifyStaffToken(token)
  } catch (error) {
    // Diagnostic-only, never the token itself: decode (unverified) tells us
    // WHICH of the ways this can fail actually happened -- a token that
    // decodes fine with a plausible exp but still fails verify() points at a
    // wrong/rotated JWT_SECRET (e.g. two backend processes momentarily alive
    // with different secrets), not a garbled or foreign token.
    const decoded = unsafeDecodeStaffToken(token)
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
    console.warn(
      `[auth] requireAuth rejected ${req.method} ${req.originalUrl}: ${reason}; ` +
        (decoded
          ? `decoded staffId=${String(decoded.staffId)} exp=${decoded.exp ?? 'n/a'} nowSec=${Math.floor(Date.now() / 1000)}`
          : 'token did not even decode as a JWT') +
        `; tokenLen=${token.length}`,
    )
    throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Invalid or expired token')
  }

  // findUniqueOrThrow, not findUnique: a token for a staff member deleted
  // after the token was issued must fail here, not proceed with an
  // undefined locationId.
  let staff
  try {
    staff = await prisma.staff.findUniqueOrThrow({ where: { id: payload.staffId } })
  } catch {
    console.warn(
      `[auth] requireAuth rejected ${req.method} ${req.originalUrl}: staffId=${payload.staffId} no longer exists`,
    )
    throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Staff account no longer exists')
  }
  req.staff = { staffId: staff.id, role: staff.role as 'owner' | 'staff', locationId: staff.locationId }

  // Sliding renewal: a session that keeps being used keeps being extended, so
  // nobody is logged out mid-shift, while a session nobody uses reaches its own
  // exp and dies. The client swaps this header's value into localStorage inside
  // apiFetch. See the CORS `exposedHeaders` in app.ts — without it the packaged
  // renderer (file:// origin) cannot read this header at all, and renewal fails
  // in production only.
  // Re-sign from staffId/role only: handing the verified payload straight back
  // to jwt.sign throws, because it already carries an `exp` claim.
  const isBackgroundRequest =
    req.header(BACKGROUND_REQUEST_HEADER) !== undefined ||
    RENEWAL_EXCLUDED_PATHS.has(req.baseUrl + req.path)

  if (shouldRenewToken(payload, Date.now()) && !isBackgroundRequest) {
    res.setHeader(
      RENEWED_TOKEN_HEADER,
      signStaffToken({ staffId: payload.staffId, role: payload.role }),
    )
  }

  next()
}
