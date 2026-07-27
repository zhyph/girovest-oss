import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import type { VerifiedStaffToken } from './jwt.js'
import { shouldRenewToken, signStaffToken, verifyStaffToken } from './jwt.js'

export const RENEWED_TOKEN_HEADER = 'X-Renewed-Token'

// Paths the client polls by itself, with no user behind them. Renewing on these
// would make an unattended-but-open terminal immortal, which is exactly what
// "an idle session still expires" forbids: /api/products/events/ticket is
// re-minted every ~4 minutes for as long as the app window is open.
// Matched against `req.baseUrl + req.path`, because requireAuth is mounted with
// `productsRouter.use(...)` and `req.path` alone would be router-relative.
export const RENEWAL_EXCLUDED_PATHS = new Set(['/api/products/events/ticket'])

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization')
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Missing or malformed Authorization header')
  }

  const token = header.slice('Bearer '.length)
  let payload: VerifiedStaffToken
  try {
    payload = verifyStaffToken(token)
  } catch {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Invalid or expired token')
  }
  req.staff = { staffId: payload.staffId, role: payload.role }

  // Sliding renewal: a session that keeps being used keeps being extended, so
  // nobody is logged out mid-shift, while a session nobody uses reaches its own
  // exp and dies. The client swaps this header's value into localStorage inside
  // apiFetch. See the CORS `exposedHeaders` in app.ts — without it the packaged
  // renderer (file:// origin) cannot read this header at all, and renewal fails
  // in production only.
  // Re-sign from staffId/role only: handing the verified payload straight back
  // to jwt.sign throws, because it already carries an `exp` claim.
  if (shouldRenewToken(payload, Date.now()) && !RENEWAL_EXCLUDED_PATHS.has(req.baseUrl + req.path)) {
    res.setHeader(
      RENEWED_TOKEN_HEADER,
      signStaffToken({ staffId: payload.staffId, role: payload.role }),
    )
  }

  next()
}
