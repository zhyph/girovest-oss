import { createPublicKey, verify } from 'node:crypto'

/**
 * Verifies a support-issued password-reset ticket -- layer 2 of password
 * recovery, for when the self-service recovery code (recoveryCodes.ts) is
 * itself lost. Minted by the update-proxy Worker's ACTIVATION_KEY after a
 * human (the licensor) approves a request in /admin; see
 * infra/update-proxy/src/lib/passwordReset.ts's header for why that's the
 * SAME Ed25519 keypair activation tokens use, and how `purpose` keeps the
 * two from ever being confused even so.
 *
 * Verification happens here, in the local server, not in the Electron shell:
 * the reset itself is a plain HTTP call against this process's own
 * /api/auth, so both installId and the activation public key travel to it as
 * env vars at spawn time (client/electron/main.ts), the same way
 * GIROVEST_INSTALL_ID already does for the update feed.
 */

// 48h: long enough to finish resetting after getting off the phone with
// support and driving back to the till, short enough that an approved-but-
// unused ticket doesn't sit around as a standing spare key.
//
// ACCEPTED LIMIT: this freshness check trusts the shop PC's own clock --
// there is no synced/monotonic time source available to a local server. That
// window is only exploitable against an approved-but-never-redeemed ticket
// (rolling the clock back to revive one); a ticket that HAS been redeemed is
// closed off regardless of the clock, by Staff.lastResetTicketIssuedAt (see
// authRoutes.ts), which is a plain issuedAt comparison, not a freshness
// check. Same class of accepted limit as activation.ts's own client-side
// checks: whoever has local admin on the shop's own machine is already
// mostly past what this can defend against.
const MAX_TICKET_AGE_MS = 48 * 60 * 60 * 1000

interface PasswordResetTicketPayload {
  readonly installId: string
  readonly login: string
  readonly purpose: string
  readonly issuedAt: string
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * Order matters, same as activation's verifyActivationToken: the signature
 * is checked BEFORE any payload field is trusted. Reading purpose/installId/
 * login out of an unverified payload and comparing them would be theatre --
 * whoever can edit the payload can edit all three.
 */
export function verifyPasswordResetTicket(
  token: string | null,
  installId: string,
  login: string,
  publicKeySpkiBase64: string,
): boolean {
  if (token == null || token === '' || publicKeySpkiBase64 === '') return false
  const [head, signature] = token.split('.')
  if (head == null || signature == null) return false

  let data: Buffer
  try {
    data = decodeBase64Url(head)
    const key = createPublicKey({
      key: Buffer.from(publicKeySpkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    })
    if (!verify(null, data, key, decodeBase64Url(signature))) return false
  } catch {
    // Broken base64, an invalid public key, a token from another algorithm:
    // all of that is an invalid ticket, not an exception to propagate.
    return false
  }

  let payload: PasswordResetTicketPayload
  try {
    payload = JSON.parse(data.toString('utf-8')) as PasswordResetTicketPayload
  } catch {
    return false
  }

  if (payload.purpose !== 'password_reset') return false
  if (payload.installId !== installId) return false
  // Exact match, not case-folded: Staff.login is a case-SENSITIVE unique
  // column (no COLLATE NOCASE), and the lookup that actually applies the new
  // password (authRoutes.ts) is exact too. A case-insensitive check here let
  // a ticket approved for "ana" verify against "Ana" and reset a DIFFERENT
  // account -- the ticket's login has to match, byte for byte, the login the
  // caller is asking to reset.
  if (typeof payload.login !== 'string' || payload.login !== login.trim()) return false

  const issuedAtMs = Date.parse(payload.issuedAt)
  if (Number.isNaN(issuedAtMs)) return false
  if (Date.now() - issuedAtMs > MAX_TICKET_AGE_MS) return false

  return true
}

/**
 * Extracts a ticket's `issuedAt` WITHOUT re-verifying its signature -- ONLY
 * ever call this on a token `verifyPasswordResetTicket` has already returned
 * true for, on the same token string. It exists so authRoutes.ts can enforce
 * single-use (a ticket's issuedAt must be strictly newer than the last one
 * actually consumed for that account, see Staff.lastResetTicketIssuedAt):
 * without that, an approved ticket has no expiry shorter than 48h and
 * nothing else ever marks it spent, so it could reset the password an
 * unlimited number of times inside its freshness window.
 */
export function unsafeDecodeTicketIssuedAt(token: string): string | null {
  const [head] = token.split('.')
  if (head == null) return null
  try {
    const payload = JSON.parse(decodeBase64Url(head).toString('utf-8')) as { issuedAt?: unknown }
    return typeof payload.issuedAt === 'string' ? payload.issuedAt : null
  } catch {
    return null
  }
}
