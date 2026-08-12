import jwt from 'jsonwebtoken'
import { createHash } from 'node:crypto'

export interface StaffTokenPayload {
  staffId: string
  role: 'owner' | 'staff'
}

// The registered claims jsonwebtoken adds on top of ours. They were always
// present at runtime; the old `as StaffTokenPayload` cast just hid them.
// Sliding renewal needs both: `iat` says when the session started, `exp` says
// how long it was granted for.
export type VerifiedStaffToken = StaffTokenPayload & { iat: number; exp: number }

// A shift is at most 12h, so a session that is actively *used* must never die
// inside one. Sliding renewal (shouldRenewToken + requireAuth) is what makes
// that true without making an idle session immortal.
export const SESSION_TTL_SECONDS = 12 * 60 * 60

function getSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET is not set')
  }
  return secret
}

// Diagnostic-only fingerprint, same shape as infra/update-proxy's
// hashTokenForLog for relay tokens: never the bearer value itself, just
// enough (SHA-256, truncated to 16 hex chars) to tell "is this literally the
// same token" apart in two separate log lines -- specifically, whether a
// token requireAuth rejects is the one a nearby signStaffToken call actually
// just issued, or some other token entirely. Sync (unlike the Workers
// version, which needs the async Web Crypto API): Node's `crypto` module
// exposes createHash synchronously.
export function hashTokenForLog(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16)
}

export function signStaffToken(payload: StaffTokenPayload): string {
  const token = jwt.sign(payload, getSecret(), { expiresIn: SESSION_TTL_SECONDS })
  // Diagnostic-only: added after a report where a token issued moments
  // earlier was rejected as already-expired by the very next request, and
  // nothing anywhere recorded what iat/exp this function actually computed
  // at sign time to compare against. now/iat/exp are logged as both epoch
  // seconds (exact arithmetic) and ISO instants (readable at a glance).
  const decoded = jwt.decode(token) as { iat?: number; exp?: number } | null
  console.info(
    `[auth] token signed for staffId=${payload.staffId} role=${payload.role} tokenHash=${hashTokenForLog(token)} ` +
      `nowSec=${Math.floor(Date.now() / 1000)} iat=${decoded?.iat ?? 'n/a'} exp=${decoded?.exp ?? 'n/a'} ` +
      `iatIso=${decoded?.iat ? new Date(decoded.iat * 1000).toISOString() : 'n/a'} ` +
      `expIso=${decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : 'n/a'}`,
  )
  return token
}

export function verifyStaffToken(token: string): VerifiedStaffToken {
  return jwt.verify(token, getSecret()) as VerifiedStaffToken
}

// Diagnostic-only: reads the claims out of a token WITHOUT checking its
// signature, purely so a rejected token's own failure log (authMiddleware.ts)
// can say WHICH of the several ways verifyStaffToken can fail actually
// happened -- malformed/truncated (this returns null), expired (exp is in
// the past despite decoding fine, i.e. signature was actually valid), or
// signed with a different secret (decodes fine, has a plausible exp, but
// verifyStaffToken still threw). Never trust the returned claims for
// anything but a log line; nothing here proves the token wasn't tampered
// with.
export function unsafeDecodeStaffToken(token: string): { staffId?: unknown; exp?: number; iat?: number } | null {
  try {
    return jwt.decode(token) as { staffId?: unknown; exp?: number; iat?: number } | null
  } catch {
    return null
  }
}

// Half-life rule: renew once the token has burned more than half of its own
// lifetime. Both operands come from the token's server-issued iat/exp, so a
// wrong clock on the client can neither extend nor truncate a session, and a
// token minted before this feature existed renews just fine — no migration.
//
// Why half and not "renew on every request": re-signing on every call would
// rotate the stored token dozens of times a minute for no benefit, and every
// rotation is another chance for an in-flight request to race the swap.
export function shouldRenewToken(payload: { iat: number; exp: number }, nowMs: number): boolean {
  const lifetime = payload.exp - payload.iat
  const age = nowMs / 1000 - payload.iat
  return age > lifetime / 2
}
