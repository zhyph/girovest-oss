import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { hashPassword, verifyPassword } from './passwords.js'
import { generateRecoveryCode, hashRecoveryCode, verifyRecoveryCode } from './recoveryCodes.js'
import { verifyPasswordResetTicket, unsafeDecodeTicketIssuedAt } from './passwordResetTickets.js'
import { signStaffToken } from './jwt.js'
import { describeClientForLog, requireAuth } from './authMiddleware.js'

export const authRouter = Router()

// Diagnostic-only descriptor for a login string in a log line. JSON.stringify
// surfaces leading/trailing whitespace, case, and non-printable characters
// that would otherwise be invisible in a log -- exactly the kind of mismatch
// that makes a correct-looking login fail an exact-match DB lookup -- without
// ever touching the password/recovery code/reset token themselves. These
// lines only ever reach a shop's own main.log, uploaded solely on the
// explicit "send diagnostics" action (see client/electron/main.ts).
function describeLoginForLog(login: string): string {
  return JSON.stringify(login)
}

const loginSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
})

// Same cap as a key/install label -- also what keeps a single distinct
// `login` value cheap to hold in the rate-limit map below.
const LOGIN_MAX_LENGTH = 120

const recoverSchema = z.object({
  login: z.string().min(1).max(LOGIN_MAX_LENGTH),
  recoveryCode: z.string().min(1),
  newPassword: z.string().min(8),
})

const supportResetSchema = z.object({
  login: z.string().min(1).max(LOGIN_MAX_LENGTH),
  token: z.string().min(1),
  newPassword: z.string().min(8),
})

// In-memory throttle for /recover, scoped by login. bcrypt.compare already
// costs ~50-100ms per attempt, but a recovery code is a standalone bearer
// secret (no second factor), so capping attempts is worth it even so.
// Per-process and not persisted -- resets on restart, which is fine for a
// local single-instance server; the point is blunting a script, not
// surviving a restart mid-attack.
const RECOVER_MAX_ATTEMPTS = 5
const RECOVER_WINDOW_MS = 15 * 60 * 1000
// Exported so authRoutes.test.ts can assert the eviction ORDER directly
// (which login got dropped) without driving 2000+ real HTTP requests through
// bcrypt just to fill the map.
export const recoverAttempts = new Map<string, number[]>()

// Distinct-key cap, not just the length cap above: this endpoint is
// unauthenticated and CORS allows any origin (the packaged app talks to it
// cross-origin from file://, so this can't be tightened per-endpoint), so a
// script on any page the shop's PC visits could otherwise grow this Map
// without bound by cycling through distinct `login` values. A Map preserves
// insertion order, so evicting the oldest key is O(1) and needs no separate
// bookkeeping.
export const RECOVER_ATTEMPTS_MAX_KEYS = 2000

// Both call sites below write to the map (even a login that turns out fine
// still gets an entry, from isRecoverRateLimited's own bookkeeping), so the
// eviction lives here rather than only after a failed attempt.
//
// `delete` before `set` is not decorative: a Map's iteration order is
// insertion order, and re-`set`-ing an EXISTING key does NOT move it to the
// end -- only a genuinely new key is appended. Without the delete, an
// actively re-attacked login (which calls this on every attempt) would sit
// at whatever position it FIRST got inserted at and be the next one evicted
// once the map fills, while a one-off flood of distinct throwaway logins
// that are never touched again sits safely behind it. That is backwards for
// a rate limiter: it should keep the entry someone is still hitting and
// evict the ones nobody has touched since -- true least-recently-used
// eviction, which requires every touch to re-append the key.
export function setRecoverAttempts(login: string, attempts: number[]): void {
  recoverAttempts.delete(login)
  recoverAttempts.set(login, attempts)
  while (recoverAttempts.size > RECOVER_ATTEMPTS_MAX_KEYS) {
    const oldest = recoverAttempts.keys().next().value
    if (oldest === undefined) break
    recoverAttempts.delete(oldest)
  }
}

function isRecoverRateLimited(login: string): boolean {
  const now = Date.now()
  const attempts = (recoverAttempts.get(login) ?? []).filter((t) => now - t < RECOVER_WINDOW_MS)
  setRecoverAttempts(login, attempts)
  return attempts.length >= RECOVER_MAX_ATTEMPTS
}

function recordRecoverAttempt(login: string): void {
  const attempts = recoverAttempts.get(login) ?? []
  attempts.push(Date.now())
  setRecoverAttempts(login, attempts)
}

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'login and password are required')
  }

  const staff = await prisma.staff.findUnique({ where: { login: parsed.data.login } })
  if (!staff) {
    console.warn(`[auth] login failed: no staff for login=${describeLoginForLog(parsed.data.login)}`)
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 401, 'Invalid login or password')
  }

  const passwordMatches = await verifyPassword(parsed.data.password, staff.passwordHash)
  if (!passwordMatches) {
    console.warn(
      `[auth] login failed: wrong password for login=${describeLoginForLog(parsed.data.login)} staffId=${staff.id}`,
    )
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 401, 'Invalid login or password')
  }
  console.info(
    `[auth] login ok for login=${describeLoginForLog(parsed.data.login)} staffId=${staff.id}; ${describeClientForLog(req)}`,
  )

  const token = signStaffToken({ staffId: staff.id, role: staff.role as 'owner' | 'staff' })

  // Backfill for every account that predates recovery codes (every account
  // that existed before this feature shipped): the only moment such an
  // account is provably in front of its own owner is a successful password
  // login, right here. Minted at most once -- recoveryCodeHash null is the
  // trigger, and the write below fills it, so the next login leaves it alone.
  // A locked-out account with a wrong password never reaches this line, so
  // this cannot retroactively rescue someone who is already unable to log
  // in; it only prevents the NEXT person from reaching that state with no
  // code at all.
  let recoveryCode: string | undefined
  if (staff.recoveryCodeHash === null) {
    recoveryCode = generateRecoveryCode()
    await prisma.staff.update({
      where: { id: staff.id },
      data: { recoveryCodeHash: await hashRecoveryCode(recoveryCode) },
    })
  }

  res.json(recoveryCode ? { token, recoveryCode } : { token })
})

authRouter.post('/recover', async (req, res) => {
  const parsed = recoverSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'login, recoveryCode and newPassword are required')
  }
  const { login, recoveryCode, newPassword } = parsed.data

  if (isRecoverRateLimited(login)) {
    console.warn(`[auth] recover blocked: rate limited for login=${describeLoginForLog(login)}`)
    throw new AppError(ErrorCodes.RATE_LIMITED, 429, 'Too many recovery attempts. Try again later.')
  }

  const staff = await prisma.staff.findUnique({ where: { login } })
  // Same 401 whether the login is unknown, has no recovery code yet, or the
  // code is wrong -- distinguishing them would let an attacker probe for
  // valid usernames. The log line below is diagnostic-only (main.log, never
  // returned to the client) so it can afford to be specific where the
  // response deliberately isn't.
  const codeMatches = staff?.recoveryCodeHash
    ? await verifyRecoveryCode(recoveryCode, staff.recoveryCodeHash)
    : false
  if (!staff || !codeMatches) {
    recordRecoverAttempt(login)
    const reason = !staff ? 'no staff' : !staff.recoveryCodeHash ? 'no recovery code set' : 'bad code'
    console.warn(`[auth] recover failed: ${reason} for login=${describeLoginForLog(login)}`)
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 401, 'Invalid login or recovery code')
  }
  console.info(`[auth] recover ok for login=${describeLoginForLog(login)} staffId=${staff.id}`)

  // Rotate: the code that was just typed in is dead the moment it works,
  // exactly like a 2FA backup code. The new one is the only copy that will
  // ever exist, and it is only ever handed back once, right here.
  const nextRecoveryCode = generateRecoveryCode()
  await prisma.staff.update({
    where: { id: staff.id },
    data: {
      passwordHash: await hashPassword(newPassword),
      recoveryCodeHash: await hashRecoveryCode(nextRecoveryCode),
    },
  })
  recoverAttempts.delete(login)

  res.json({ recoveryCode: nextRecoveryCode })
})

// Layer 2 of password recovery: the fallback for when the recovery code
// above is ALSO lost. No rate limiting here on purpose, unlike /recover --
// the bearer secret is an unforgeable Ed25519 signature, not a human-typeable
// code, so there is no brute-force surface to blunt; a wrong login or token
// just fails, every time, regardless of how many times it's tried.
authRouter.post('/reset-with-support-token', async (req, res) => {
  const parsed = supportResetSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'login, token and newPassword are required')
  }

  const installId = process.env.GIROVEST_INSTALL_ID
  const publicKey = process.env.GIROVEST_ACTIVATION_PUBKEY
  if (!installId || !publicKey) {
    // The hosted web build, or a dev environment with no activation config:
    // there is no possible ticket to verify against, so this path can never
    // succeed here regardless of what's presented.
    console.warn('[auth] support-reset unavailable: missing GIROVEST_INSTALL_ID/GIROVEST_ACTIVATION_PUBKEY')
    throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Support-mediated reset is not available in this build')
  }
  if (!verifyPasswordResetTicket(parsed.data.token, installId, parsed.data.login, publicKey)) {
    console.warn(
      `[auth] support-reset failed: signature/purpose/freshness check failed for login=${describeLoginForLog(parsed.data.login)} installId=${installId}`,
    )
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 401, 'Invalid or expired reset ticket')
  }

  // Single-use: verifyPasswordResetTicket alone only checks the signature and
  // a 48h freshness window, not whether this exact ticket already succeeded
  // once. Without this, the same approved ticket could reset the password an
  // unlimited number of times inside that window. Decoding only AFTER
  // verification passed -- this trusts the payload, verify() already proved
  // it wasn't tampered with.
  const ticketIssuedAt = unsafeDecodeTicketIssuedAt(parsed.data.token)
  if (ticketIssuedAt === null) {
    // Unreachable in practice (verify() already parsed this same payload
    // successfully), but failing closed on a security-critical path beats
    // assuming it can't happen.
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 401, 'Invalid or expired reset ticket')
  }

  const staff = await prisma.staff.findUnique({ where: { login: parsed.data.login } })
  if (!staff) {
    // The ticket's signature and embedded login checked out above (against
    // whatever was typed into the request form), but that login doesn't
    // match any account here -- a typo/case/whitespace difference between
    // the request form and the real Staff.login is exactly what this line is
    // for catching, since describeLoginForLog would show it.
    console.warn(`[auth] support-reset failed: no staff for login=${describeLoginForLog(parsed.data.login)}`)
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 401, 'Invalid or expired reset ticket')
  }
  if (staff.lastResetTicketIssuedAt && Date.parse(ticketIssuedAt) <= staff.lastResetTicketIssuedAt.getTime()) {
    console.warn(
      `[auth] support-reset failed: ticket already used for login=${describeLoginForLog(parsed.data.login)} staffId=${staff.id}`,
    )
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 401, 'Invalid or expired reset ticket')
  }

  // Same rotate-on-use as /recover: she leaves with a fresh self-service
  // code, not dependent on support again for the next lockout.
  const nextRecoveryCode = generateRecoveryCode()

  // updateMany with the same freshness condition baked into `where`, not
  // update() after the check above -- that check-then-write shape has a
  // replay race: two requests carrying the SAME approved ticket, fired close
  // together (a doubled network retry, or someone deliberately racing it),
  // can both read the same lastResetTicketIssuedAt before either write lands,
  // both pass the check, and both reset the password. A single UPDATE ...
  // WHERE statement is what makes the check-and-set atomic: the database
  // serializes concurrent writes to the same row, so whichever one commits
  // first moves lastResetTicketIssuedAt forward, and the loser's WHERE
  // clause no longer matches when its statement actually executes -- it
  // affects zero rows instead of overwriting what the winner just set.
  const result = await prisma.staff.updateMany({
    where: {
      id: staff.id,
      OR: [{ lastResetTicketIssuedAt: null }, { lastResetTicketIssuedAt: { lt: new Date(ticketIssuedAt) } }],
    },
    data: {
      passwordHash: await hashPassword(parsed.data.newPassword),
      recoveryCodeHash: await hashRecoveryCode(nextRecoveryCode),
      lastResetTicketIssuedAt: new Date(ticketIssuedAt),
    },
  })
  if (result.count === 0) {
    // Lost the race (or someone replayed a ticket already consumed between
    // the read above and here): same response as any other already-used
    // ticket, so a racing replay attempt learns nothing it couldn't already
    // infer from the sequential case.
    console.warn(
      `[auth] support-reset failed: lost race/already consumed for login=${describeLoginForLog(parsed.data.login)} staffId=${staff.id}`,
    )
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 401, 'Invalid or expired reset ticket')
  }
  console.info(`[auth] support-reset ok for login=${describeLoginForLog(parsed.data.login)} staffId=${staff.id}`)

  res.json({ recoveryCode: nextRecoveryCode })
})

authRouter.get('/me', requireAuth, async (req, res) => {
  const staff = await prisma.staff.findUnique({
    where: { id: req.staff!.staffId },
    include: { location: true },
  })
  if (!staff) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Staff account no longer exists')
  }
  res.json({
    id: staff.id,
    name: staff.name,
    role: staff.role,
    locationId: staff.locationId,
    locationName: staff.location.name,
    locale: staff.location.locale,
  })
})

// A recovery code is only ever handed back once (setup, /recover, or a
// backfilled login), and the reveal screen has no persistence of its own --
// close the app, crash, or dismiss it before reading it, and it's gone
// forever with no way to get it back, ever. This is the way back: while
// still logged in, mint a fresh one on demand, the same rotate-and-reveal
// shape as every other path that hands one out.
//
// Requires the current password, not just a valid session token: without
// this, a JWT alone (which merely proves "logged in earlier", and which
// sliding renewal keeps alive for as long as the app stays open) could mint
// a brand new, no-expiry bearer secret capable of resetting the password on
// its own -- turning a stolen short-lived token into a standing one. The
// password is the thing that actually proves it's still her.
const rotateRecoveryCodeSchema = z.object({
  currentPassword: z.string().min(1),
})

authRouter.post('/recovery-code/rotate', requireAuth, async (req, res) => {
  const parsed = rotateRecoveryCodeSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'currentPassword is required')
  }

  const staff = await prisma.staff.findUniqueOrThrow({ where: { id: req.staff!.staffId } })
  const passwordMatches = await verifyPassword(parsed.data.currentPassword, staff.passwordHash)
  if (!passwordMatches) {
    // 403, deliberately not 401: this route already ran requireAuth, so the
    // session itself is fine -- this is a business check layered on top of
    // it. api.ts's apiFetch calls clearToken() on ANY 401 REGARDLESS of
    // suppressAuthLogoutEvent (that flag only suppresses the global
    // 'auth:logout' event, found the hard way -- a wrong current password
    // here silently wiped a perfectly valid session token, so the very next
    // attempt with the CORRECT password also failed, now with no token
    // attached at all). 403 never enters that branch.
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 403, 'Invalid password')
  }

  const nextRecoveryCode = generateRecoveryCode()
  await prisma.staff.update({
    where: { id: staff.id },
    data: { recoveryCodeHash: await hashRecoveryCode(nextRecoveryCode) },
  })
  res.json({ recoveryCode: nextRecoveryCode })
})
