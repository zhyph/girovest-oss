import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { app } from '../app.js'
import { prisma } from '../db/client.js'
import { hashPassword, verifyPassword } from './passwords.js'
import { generateRecoveryCode, hashRecoveryCode } from './recoveryCodes.js'
import { BACKGROUND_REQUEST_HEADER } from './authMiddleware.js'
import { recoverAttempts, setRecoverAttempts, RECOVER_ATTEMPTS_MAX_KEYS } from './authRoutes.js'

describe('POST /api/auth/login', () => {
  let locationId: string

  beforeAll(async () => {
    const location = await prisma.location.create({
      data: { name: 'Loja Teste', address: 'Rua Teste, 1' },
    })
    locationId = location.id

    await prisma.staff.create({
      data: {
        name: 'Ana Owner',
        login: 'ana',
        passwordHash: await hashPassword('correct-horse'),
        role: 'owner',
        locationId,
      },
    })
  })

  afterAll(async () => {
    await prisma.staff.deleteMany({ where: { locationId } })
    await prisma.location.delete({ where: { id: locationId } })
  })

  it('returns a token for correct credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ login: 'ana', password: 'correct-horse' })

    expect(response.status).toBe(200)
    expect(typeof response.body.token).toBe('string')
  })

  it('rejects an incorrect password with INVALID_CREDENTIALS', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ login: 'ana', password: 'wrong-password' })

    expect(response.status).toBe(401)
    expect(response.body.code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects an unknown login with INVALID_CREDENTIALS (not a different error)', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ login: 'nobody', password: 'whatever' })

    expect(response.status).toBe(401)
    expect(response.body.code).toBe('INVALID_CREDENTIALS')
  })
})

describe('GET /api/auth/me', () => {
  let locationId: string

  beforeAll(async () => {
    const location = await prisma.location.create({
      data: { name: 'Loja Teste Me', address: 'Rua Teste, 2' },
    })
    locationId = location.id

    await prisma.staff.create({
      data: {
        name: 'Bruno Staff',
        login: 'bruno',
        passwordHash: await hashPassword('correct-horse'),
        role: 'staff',
        locationId,
      },
    })
  })

  afterAll(async () => {
    await prisma.staff.deleteMany({ where: { locationId } })
    await prisma.location.delete({ where: { id: locationId } })
  })

  it('returns the logged-in staff name, role, and location', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ login: 'bruno', password: 'correct-horse' })

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ name: 'Bruno Staff', role: 'staff', locationId })
  })

  it('returns the location locale, defaulting to pt-BR', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ login: 'bruno', password: 'correct-horse' })

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`)

    expect(response.body.locale).toBe('pt-BR')
  })

  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/auth/me')
    expect(response.status).toBe(401)
  })
})

describe('POST /api/auth/login recovery-code backfill', () => {
  let locationId: string

  beforeAll(async () => {
    const location = await prisma.location.create({
      data: { name: 'Loja Teste Backfill', address: 'Rua Teste, 5' },
    })
    locationId = location.id

    // No recoveryCodeHash on purpose: this is exactly the shape of every
    // account that existed before the feature shipped.
    await prisma.staff.create({
      data: {
        name: 'Elis Owner',
        login: 'elis',
        passwordHash: await hashPassword('correct-horse'),
        role: 'owner',
        locationId,
      },
    })
  })

  afterAll(async () => {
    await prisma.staff.deleteMany({ where: { locationId } })
    await prisma.location.delete({ where: { id: locationId } })
  })

  it('mints and returns a recovery code on the first successful login of an account that has none', async () => {
    const response = await request(app).post('/api/auth/login').send({ login: 'elis', password: 'correct-horse' })

    expect(response.status).toBe(200)
    expect(typeof response.body.recoveryCode).toBe('string')

    const staff = await prisma.staff.findUniqueOrThrow({ where: { login: 'elis' } })
    expect(staff.recoveryCodeHash).not.toBeNull()
  })

  it('does not mint a second code, or return one, on a later login', async () => {
    const response = await request(app).post('/api/auth/login').send({ login: 'elis', password: 'correct-horse' })

    expect(response.status).toBe(200)
    expect(response.body.recoveryCode).toBeUndefined()
  })

  it('never mints one on a failed login attempt', async () => {
    const location = await prisma.location.create({
      data: { name: 'Loja Teste Backfill Falha', address: 'Rua Teste, 6' },
    })
    await prisma.staff.create({
      data: {
        name: 'Fia Owner',
        login: 'fia',
        passwordHash: await hashPassword('correct-horse'),
        role: 'owner',
        locationId: location.id,
      },
    })

    const response = await request(app).post('/api/auth/login').send({ login: 'fia', password: 'wrong-password' })

    expect(response.status).toBe(401)
    const staff = await prisma.staff.findUniqueOrThrow({ where: { login: 'fia' } })
    expect(staff.recoveryCodeHash).toBeNull()

    await prisma.staff.deleteMany({ where: { locationId: location.id } })
    await prisma.location.delete({ where: { id: location.id } })
  })
})

describe('POST /api/auth/recover', () => {
  let locationId: string
  let recoveryCode: string

  beforeAll(async () => {
    const location = await prisma.location.create({
      data: { name: 'Loja Teste Recover', address: 'Rua Teste, 3' },
    })
    locationId = location.id
    recoveryCode = generateRecoveryCode()

    await prisma.staff.create({
      data: {
        name: 'Carla Owner',
        login: 'carla',
        passwordHash: await hashPassword('old-password'),
        role: 'owner',
        locationId,
        recoveryCodeHash: await hashRecoveryCode(recoveryCode),
      },
    })
  })

  afterAll(async () => {
    await prisma.staff.deleteMany({ where: { locationId } })
    await prisma.location.delete({ where: { id: locationId } })
  })

  it('rejects an unknown login with INVALID_CREDENTIALS (not a different error)', async () => {
    const response = await request(app)
      .post('/api/auth/recover')
      .send({ login: 'nobody', recoveryCode: 'WHATEVER-CODE-HERE-NOW', newPassword: 'brand-new-password' })

    expect(response.status).toBe(401)
    expect(response.body.code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects a wrong recovery code', async () => {
    const response = await request(app)
      .post('/api/auth/recover')
      .send({ login: 'carla', recoveryCode: 'WRONG-CODE-0000-0000', newPassword: 'brand-new-password' })

    expect(response.status).toBe(401)
    expect(response.body.code).toBe('INVALID_CREDENTIALS')
  })

  it('accepts the right code case/dash-insensitively, sets the new password, and hands back a fresh code', async () => {
    const response = await request(app).post('/api/auth/recover').send({
      login: 'carla',
      recoveryCode: recoveryCode.toLowerCase().replace(/-/g, ' '),
      newPassword: 'brand-new-password',
    })

    expect(response.status).toBe(200)
    expect(typeof response.body.recoveryCode).toBe('string')
    expect(response.body.recoveryCode).not.toBe(recoveryCode)

    const staff = await prisma.staff.findUniqueOrThrow({ where: { login: 'carla' } })
    await expect(verifyPassword('brand-new-password', staff.passwordHash)).resolves.toBe(true)

    // The old password no longer works.
    const oldLogin = await request(app).post('/api/auth/login').send({ login: 'carla', password: 'old-password' })
    expect(oldLogin.status).toBe(401)

    // Nor does the just-used recovery code -- it was single-use, rotated away.
    const reuse = await request(app)
      .post('/api/auth/recover')
      .send({ login: 'carla', recoveryCode, newPassword: 'another-password' })
    expect(reuse.status).toBe(401)
  })

  it('rejects an account with no recovery code yet (accounts created before this feature)', async () => {
    const location = await prisma.location.create({
      data: { name: 'Loja Teste Sem Recovery', address: 'Rua Teste, 4' },
    })
    await prisma.staff.create({
      data: {
        name: 'Duda Owner',
        login: 'duda',
        passwordHash: await hashPassword('some-password'),
        role: 'owner',
        locationId: location.id,
      },
    })

    const response = await request(app)
      .post('/api/auth/recover')
      .send({ login: 'duda', recoveryCode: 'ANY-CODE-AT-ALL-0000', newPassword: 'brand-new-password' })

    expect(response.status).toBe(401)
    expect(response.body.code).toBe('INVALID_CREDENTIALS')

    await prisma.staff.deleteMany({ where: { locationId: location.id } })
    await prisma.location.delete({ where: { id: location.id } })
  })
})

describe('POST /api/auth/reset-with-support-token', () => {
  let locationId: string
  const INSTALL_ID = 'b2a4f6c8-1111-4222-8333-444455556666'
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const PUBLIC_SPKI = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const originalEnv = { installId: process.env.GIROVEST_INSTALL_ID, pubkey: process.env.GIROVEST_ACTIVATION_PUBKEY }

  function b64url(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  function mint(login: string, purpose = 'password_reset', issuedAt = new Date().toISOString()): string {
    const canonical = JSON.stringify({ installId: INSTALL_ID, login, purpose, issuedAt })
    const data = Buffer.from(canonical, 'utf-8')
    return `${b64url(data)}.${b64url(sign(null, data, privateKey))}`
  }

  beforeAll(async () => {
    const location = await prisma.location.create({
      data: { name: 'Loja Teste Support Reset', address: 'Rua Teste, 7' },
    })
    locationId = location.id
    await prisma.staff.create({
      data: {
        name: 'Gil Owner',
        login: 'gil',
        passwordHash: await hashPassword('old-password'),
        role: 'owner',
        locationId,
      },
    })
  })

  afterAll(async () => {
    await prisma.staff.deleteMany({ where: { locationId } })
    await prisma.location.delete({ where: { id: locationId } })
  })

  beforeEach(() => {
    process.env.GIROVEST_INSTALL_ID = INSTALL_ID
    process.env.GIROVEST_ACTIVATION_PUBKEY = PUBLIC_SPKI
  })

  afterEach(() => {
    if (originalEnv.installId === undefined) delete process.env.GIROVEST_INSTALL_ID
    else process.env.GIROVEST_INSTALL_ID = originalEnv.installId
    if (originalEnv.pubkey === undefined) delete process.env.GIROVEST_ACTIVATION_PUBKEY
    else process.env.GIROVEST_ACTIVATION_PUBKEY = originalEnv.pubkey
  })

  it('resets the password and hands back a fresh recovery code for a valid ticket', async () => {
    const response = await request(app)
      .post('/api/auth/reset-with-support-token')
      .send({ login: 'gil', token: mint('gil'), newPassword: 'support-reset-password' })

    expect(response.status).toBe(200)
    expect(typeof response.body.recoveryCode).toBe('string')

    const staff = await prisma.staff.findUniqueOrThrow({ where: { login: 'gil' } })
    await expect(verifyPassword('support-reset-password', staff.passwordHash)).resolves.toBe(true)
    expect(staff.recoveryCodeHash).not.toBeNull()
  })

  // Without this, an approved ticket has no expiry shorter than 48h and
  // nothing else ever marks it spent -- it could reset the password an
  // unlimited number of times inside that window.
  it('rejects reusing the same ticket a second time', async () => {
    const token = mint('gil')
    const first = await request(app)
      .post('/api/auth/reset-with-support-token')
      .send({ login: 'gil', token, newPassword: 'first-reset-password' })
    expect(first.status).toBe(200)

    const second = await request(app)
      .post('/api/auth/reset-with-support-token')
      .send({ login: 'gil', token, newPassword: 'second-reset-password' })
    expect(second.status).toBe(401)

    const staff = await prisma.staff.findUniqueOrThrow({ where: { login: 'gil' } })
    await expect(verifyPassword('first-reset-password', staff.passwordHash)).resolves.toBe(true)
    await expect(verifyPassword('second-reset-password', staff.passwordHash)).resolves.toBe(false)
  })

  it('rejects a case-mismatched login even though the ticket carries an exact login', async () => {
    const response = await request(app)
      .post('/api/auth/reset-with-support-token')
      .send({ login: 'GIL', token: mint('gil'), newPassword: 'support-reset-password' })

    expect(response.status).toBe(401)
  })

  it('rejects a ticket minted for a different login', async () => {
    const response = await request(app)
      .post('/api/auth/reset-with-support-token')
      .send({ login: 'gil', token: mint('someone-else'), newPassword: 'support-reset-password' })

    expect(response.status).toBe(401)
    expect(response.body.code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects a ticket minted for a different purpose', async () => {
    const response = await request(app)
      .post('/api/auth/reset-with-support-token')
      .send({ login: 'gil', token: mint('gil', 'activation'), newPassword: 'support-reset-password' })

    expect(response.status).toBe(401)
  })

  it('refuses when the build has no activation config, regardless of the token', async () => {
    delete process.env.GIROVEST_INSTALL_ID
    delete process.env.GIROVEST_ACTIVATION_PUBKEY

    const response = await request(app)
      .post('/api/auth/reset-with-support-token')
      .send({ login: 'gil', token: mint('gil'), newPassword: 'support-reset-password' })

    expect(response.status).toBe(401)
  })

  // The sequential double-use test above proves the check catches a SECOND,
  // later request. It does not prove the check is race-free: a plain
  // read-then-write (findUnique, then update) lets two requests racing on
  // the SAME still-valid ticket both read lastResetTicketIssuedAt as null
  // before either write lands, so both would pass and both would "win" --
  // the fix is an atomic updateMany() whose WHERE clause re-checks the
  // freshness condition as part of the single UPDATE statement.
  it('lets only one of two concurrent requests carrying the same ticket succeed', async () => {
    const token = mint('gil')
    const [first, second] = await Promise.all([
      request(app)
        .post('/api/auth/reset-with-support-token')
        .send({ login: 'gil', token, newPassword: 'racer-a-password' }),
      request(app)
        .post('/api/auth/reset-with-support-token')
        .send({ login: 'gil', token, newPassword: 'racer-b-password' }),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([200, 401])

    const winner = first.status === 200 ? 'racer-a-password' : 'racer-b-password'
    const loser = first.status === 200 ? 'racer-b-password' : 'racer-a-password'
    const staff = await prisma.staff.findUniqueOrThrow({ where: { login: 'gil' } })
    await expect(verifyPassword(winner, staff.passwordHash)).resolves.toBe(true)
    await expect(verifyPassword(loser, staff.passwordHash)).resolves.toBe(false)
  })
})

describe('recover-attempts rate-limit eviction', () => {
  afterEach(() => recoverAttempts.clear())

  // Reproduces the bug directly rather than driving 2000+ HTTP requests
  // through bcrypt: fill the map to its cap, "re-touch" one early key the
  // way a real repeated attack would (via setRecoverAttempts, same as
  // isRecoverRateLimited/recordRecoverAttempt do), then push the map one over
  // the cap and confirm the untouched key -- not the touched one -- is what
  // gets evicted.
  it('evicts the least-recently-touched key, not the first-inserted one', () => {
    setRecoverAttempts('actively-attacked', [Date.now()])
    for (let i = 0; i < RECOVER_ATTEMPTS_MAX_KEYS - 1; i += 1) {
      setRecoverAttempts(`filler-${i}`, [Date.now()])
    }
    expect(recoverAttempts.size).toBe(RECOVER_ATTEMPTS_MAX_KEYS)

    // Re-touch the target, same as a genuine repeated attempt against it
    // would, via the exact function isRecoverRateLimited/recordRecoverAttempt
    // both call.
    setRecoverAttempts('actively-attacked', [Date.now()])
    // One more distinct key pushes the map over the cap and triggers eviction.
    setRecoverAttempts('filler-last', [Date.now()])

    expect(recoverAttempts.has('actively-attacked')).toBe(true)
    expect(recoverAttempts.has('filler-0')).toBe(false)
  })
})

describe('POST /api/auth/recovery-code/rotate', () => {
  let locationId: string

  beforeAll(async () => {
    const location = await prisma.location.create({
      data: { name: 'Loja Teste Rotate', address: 'Rua Teste, 8' },
    })
    locationId = location.id
    await prisma.staff.create({
      data: {
        name: 'Helo Owner',
        login: 'helo',
        passwordHash: await hashPassword('correct-horse'),
        role: 'owner',
        locationId,
        recoveryCodeHash: await hashRecoveryCode('OLDC-ODE0-0000-0000'),
      },
    })
  })

  afterAll(async () => {
    await prisma.staff.deleteMany({ where: { locationId } })
    await prisma.location.delete({ where: { id: locationId } })
  })

  it('requires an authenticated session', async () => {
    const response = await request(app).post('/api/auth/recovery-code/rotate')
    expect(response.status).toBe(401)
  })

  it('requires the current password, not just a valid session', async () => {
    const login = await request(app).post('/api/auth/login').send({ login: 'helo', password: 'correct-horse' })

    const response = await request(app)
      .post('/api/auth/recovery-code/rotate')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ currentPassword: 'wrong-password' })

    // 403, not 401: this session token IS valid (requireAuth already passed)
    // -- 401 here would make apiFetch clear it client-side regardless of
    // suppressAuthLogoutEvent, logging her out over a mistyped password on
    // an otherwise-fine session.
    expect(response.status).toBe(403)
    expect(response.body.code).toBe('INVALID_CREDENTIALS')
  })

  it('mints a fresh code for the logged-in staff, replacing the old one', async () => {
    const login = await request(app).post('/api/auth/login').send({ login: 'helo', password: 'correct-horse' })

    const response = await request(app)
      .post('/api/auth/recovery-code/rotate')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ currentPassword: 'correct-horse' })

    expect(response.status).toBe(200)
    expect(typeof response.body.recoveryCode).toBe('string')
    expect(response.body.recoveryCode).not.toBe('OLDC-ODE0-0000-0000')

    // The old code, shown once at some earlier point, no longer works.
    const recover = await request(app)
      .post('/api/auth/recover')
      .send({ login: 'helo', recoveryCode: 'OLDC-ODE0-0000-0000', newPassword: 'irrelevant-password' })
    expect(recover.status).toBe(401)
  })
})

describe('CORS', () => {
  it('allows cross-origin requests', async () => {
    const response = await request(app).get('/health')
    expect(response.headers['access-control-allow-origin']).toBe('*')
  })

  // The packaged Electron renderer runs on a file:// origin and talks to
  // http://localhost:3000, so every API call is cross-origin. Without an
  // explicit Access-Control-Expose-Headers the browser hides X-Renewed-Token
  // from JS and sliding renewal silently dies in production only — no other
  // test would notice, because none of them go through a real CORS layer.
  it('exposes the session renewal header to cross-origin callers', async () => {
    const response = await request(app).get('/health')
    expect(response.headers['access-control-expose-headers']).toContain('X-Renewed-Token')
  })

  // The mirror image of the above: X-Background-Request travels the other way,
  // so the preflight has to allow it. cors() reflects Access-Control-Request-
  // Headers by default — this pins that, because pinning an explicit
  // allowedHeaders list later would silently drop the marker and every polling
  // screen would quietly start renewing the session again.
  it('allows the background-request marker on a preflight', async () => {
    const response = await request(app)
      .options('/api/auth/me')
      .set('Origin', 'null')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', `authorization,${BACKGROUND_REQUEST_HEADER}`)

    expect(response.headers['access-control-allow-headers']).toContain(BACKGROUND_REQUEST_HEADER)
  })
})
