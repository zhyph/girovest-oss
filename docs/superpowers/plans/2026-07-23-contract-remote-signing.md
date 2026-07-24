# Contract Remote Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff hand a client's phone a QR code that opens a draw-to-sign page over the shop's local network, and have the resulting signature embed into the same Contract the print view (Plan 5) already renders — no separate "signed" document shape.

**Architecture:** A single-use, time-limited signing token is issued by the authenticated desktop API for a Contract. A second, minimal Express app (`signingApp`) — unauthenticated, bound only to the machine's detected LAN IPv4 address(es), never `0.0.0.0` — serves a small hand-written HTML/JS signing page at `GET /sign/:token` and accepts the drawn signature at `POST /sign/:token/submit`. Both `app` (the existing authenticated API) and `signingApp` run in the same backend process and share the same Prisma/SQLite connection, so a phone's submission is immediately visible to the desktop. The desktop shows the QR code in a modal and polls the Contract via the existing `useContract` hook (extended with a `refetchInterval` option) until `signatureStatus` flips to `signed`.

**Tech Stack:** Express 5 (second app instance, same process), Prisma (new `SigningToken` model), Node's built-in `crypto` (token generation) and `os` (LAN interface detection) — no new server dependency. Client adds one new dependency: `qrcode` (renders the signing URL as a QR code image; MIT-licensed, zero runtime dependencies for its browser build).

## Global Constraints

- The signing token is generated with `crypto.randomBytes(32).toString('base64url')` (256 bits of entropy) — never a sequential ID or anything guessable — because it is the *only* access control on an unauthenticated, LAN-exposed endpoint.
- A token expires 15 minutes after issuance and is single-use: once consumed by a successful submit, or replaced by a freshly issued token for the same Contract, it can never be used again.
- `signingApp` must bind to each specific detected LAN IPv4 address individually, never `0.0.0.0` — binding to all interfaces would needlessly widen exposure beyond the network the QR code targets. If zero LAN candidates are detected, `signingApp` doesn't bind anywhere and "Assinar remotamente" is disabled client-side with an explanation.
- The signing page served by `GET /sign/:token` is plain HTML/JS with everything inlined (no `<script src>`, no CDN, no build step) — the signing phone can't be assumed to have general internet access.
- `signingApp` exposes only `GET /sign/:token` and `POST /sign/:token/submit` — nothing else. It must never touch `requireAuth` or any other route from the main `app`.
- The existing authenticated `app` keeps binding exactly as it does today (`127.0.0.1` under Electron via `client/electron/main.ts`'s `HOST` env var, `0.0.0.0` when run standalone) — this plan does not change that.
- The captured signature is a canvas drawing downsampled to a small, fixed pixel size before submit (target: a few tens of KB as a base64 PNG) — not a full-resolution photo upload.
- Once submitted, the signature image renders into the *same* signature line a hand-signed printed copy would leave blank (already implemented in `ContractPrintView.tsx` from Plan 5 — this plan populates `signatureImage`/`signatureStatus`/`signedAt`, it does not touch the print view).
- No hardcoded `pt-BR` assumptions beyond what's already in the signing page's copy (the signing page itself is shop-facing UI text, same as the rest of this pt-BR-only app today — no locale plumbing needed here).
- Cancelling a Contract and marking installments paid remain unaffected by signing status — this plan does not add a "locked" check anywhere, because no endpoint exists yet that edits a signed Contract's terms (no `PATCH /api/contracts/:id`). There is nothing to lock. Do not add one speculatively.
- Consuming a signing token (marking it used and writing the signature) must be one atomic, conditional database write — not a separate "check validity, then write" — so two near-simultaneous submits with the same token can never both succeed.

---

## File Structure

- `server/prisma/models.prisma` — new `SigningToken` model; `Contract` gains a `signingTokens SigningToken[]` back-relation.
- `server/src/services/signingService.ts` — token issuance, validity check, and signature submission (single service, three functions).
- `server/src/network/lanNetwork.ts` — pure LAN-IPv4-candidate detection, injectable for tests.
- `server/src/signingPage.ts` — the static HTML/JS signing page as a template function.
- `server/src/signingApp.ts` — the second, minimal Express app.
- `server/src/server.ts` — modified to also start `signingApp` listening on every detected LAN candidate.
- `server/src/routes/contracts.ts` — gains `POST /:id/sign-token`.
- `client/src/features/contracts/contractSchemas.ts` — gains `SigningTokenResponse`/`LanCandidate` types.
- `client/src/features/contracts/useContracts.ts` — gains `useIssueSigningToken`; `useContract` gains an options param.
- `client/src/features/contracts/SignRemotelyModal.tsx` — new component: QR display, candidate picker, live polling.
- `client/src/features/contracts/ContractsPage.tsx` — gains a per-row "Assinar remotamente" action.
- `client/src/locales/pt-BR/contracts.json` — new `"sign"` key block.

---

### Task 1: `SigningToken` model + migration + `signingService.ts`

**Files:**
- Modify: `server/prisma/models.prisma`
- Create: `server/src/services/signingService.ts`
- Test: `server/src/services/signingService.test.ts`

**Interfaces:**
- Consumes: `prisma` (`../db/client.js`), `AppError`/`ErrorCodes` (`../errors/`).
- Produces:
  - `issueSigningToken(contractId: string): Promise<{ token: string; expiresAt: Date }>`
  - `checkTokenValidity(token: string): Promise<'valid' | 'expired' | 'used' | 'not_found'>`
  - `submitSignature(token: string, signatureImage: string): Promise<void>` — throws `AppError` with the same four reasons as `checkTokenValidity` maps to (`NOT_FOUND` for `not_found`, `SIGNING_TOKEN_INVALID` for `expired`/`used`) if the token isn't currently valid.
  Consumed by Task 3 (`signingApp`'s two routes) and Task 4 (the authenticated `sign-token` route).

- [ ] **Step 1: Add the `SIGNING_TOKEN_INVALID` error code**

Modify `server/src/errors/errorCodes.ts` — add one entry to the `ErrorCodes` object:

```ts
export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  DUE_DATE_BEFORE_CHECKOUT: 'DUE_DATE_BEFORE_CHECKOUT',
  PRODUCT_UNAVAILABLE: 'PRODUCT_UNAVAILABLE',
  INVALID_ALLOCATION_TRANSITION: 'INVALID_ALLOCATION_TRANSITION',
  CHECKOUT_TOO_EARLY: 'CHECKOUT_TOO_EARLY',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  CANNOT_DELETE_WITH_HISTORY: 'CANNOT_DELETE_WITH_HISTORY',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  PRODUCT_NOT_IN_CIRCULATION: 'PRODUCT_NOT_IN_CIRCULATION',
  SETUP_ALREADY_COMPLETE: 'SETUP_ALREADY_COMPLETE',
  SIGNING_TOKEN_INVALID: 'SIGNING_TOKEN_INVALID',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]
```

- [ ] **Step 2: Add the `SigningToken` model**

Modify `server/prisma/models.prisma` — add this model anywhere after the `Contract` model:

```prisma
model SigningToken {
  id         String    @id @default(uuid())
  token      String    @unique
  contractId String
  expiresAt  DateTime
  usedAt     DateTime?
  createdAt  DateTime  @default(now())

  contract Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)
}
```

Add the back-relation to the `Contract` model — find this block:

```prisma
  location     Location      @relation(fields: [locationId], references: [id])
  client       Client        @relation(fields: [clientId], references: [id])
  staff        Staff         @relation(fields: [staffId], references: [id])
  allocations  Allocation[]
  installments Installment[]

  @@unique([locationId, number])
}
```

and change it to:

```prisma
  location     Location      @relation(fields: [locationId], references: [id])
  client       Client        @relation(fields: [clientId], references: [id])
  staff        Staff         @relation(fields: [staffId], references: [id])
  allocations  Allocation[]
  installments Installment[]
  signingTokens SigningToken[]

  @@unique([locationId, number])
}
```

- [ ] **Step 3: Regenerate the schema and run the migration**

Run: `cd server && npm run db:schema && npx prisma migrate dev --name add_signing_token`

This is a purely additive migration (one new table, one new nullable-free FK column pointing at it) — no existing table is altered, so it's safe for `prisma migrate dev` to auto-generate against a disposable/dev database. Confirm the generated SQL under `server/prisma/sqlite/migrations/<timestamp>_add_signing_token/migration.sql` contains only a `CREATE TABLE "SigningToken"` statement (no `ALTER TABLE` on any existing table) before proceeding — if it contains anything else, stop and re-examine the schema diff before continuing.

- [ ] **Step 4: Write the failing service tests**

Create `server/src/services/signingService.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { issueSigningToken, checkTokenValidity, submitSignature } from './signingService.js'

let contractId: string

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  const staff = await prisma.staff.create({
    data: { name: 'S', login: `staff-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId: location.id },
  })
  const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@example.com' } })
  const contract = await prisma.contract.create({
    data: {
      number: 1,
      locationId: location.id,
      clientId: client.id,
      staffId: staff.id,
      eventDate: new Date('2026-10-03'),
      paymentMethod: 'PIX',
    },
  })
  contractId = contract.id
})

afterEach(async () => {
  await prisma.signingToken.deleteMany()
  await prisma.installment.deleteMany()
  await prisma.allocation.deleteMany()
  await prisma.contract.deleteMany()
  await prisma.client.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('issueSigningToken', () => {
  it('creates a token expiring 15 minutes from now', async () => {
    const before = Date.now()
    const { token, expiresAt } = await issueSigningToken(contractId)

    expect(token.length).toBeGreaterThan(20)
    expect(expiresAt.getTime()).toBeGreaterThan(before + 14 * 60 * 1000)
    expect(expiresAt.getTime()).toBeLessThan(before + 16 * 60 * 1000)
  })

  it('invalidates a previously issued token for the same contract', async () => {
    const first = await issueSigningToken(contractId)
    const second = await issueSigningToken(contractId)

    expect(await checkTokenValidity(first.token)).toBe('not_found')
    expect(await checkTokenValidity(second.token)).toBe('valid')
  })

  it('throws NOT_FOUND for a missing contract', async () => {
    await expect(issueSigningToken('missing-id')).rejects.toThrow(AppError)
  })
})

describe('checkTokenValidity', () => {
  it('returns not_found for an unknown token', async () => {
    expect(await checkTokenValidity('unknown-token')).toBe('not_found')
  })

  it('returns expired for a token past its expiry', async () => {
    const { token } = await issueSigningToken(contractId)
    await prisma.signingToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } })

    expect(await checkTokenValidity(token)).toBe('expired')
  })

  it('returns used for an already-consumed token', async () => {
    const { token } = await issueSigningToken(contractId)
    await submitSignature(token, 'data:image/png;base64,abc')

    expect(await checkTokenValidity(token)).toBe('used')
  })
})

describe('submitSignature', () => {
  it('marks the contract signed and the token used', async () => {
    const { token } = await issueSigningToken(contractId)

    await submitSignature(token, 'data:image/png;base64,abc')

    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } })
    expect(contract.signatureStatus).toBe('signed')
    expect(contract.signatureImage).toBe('data:image/png;base64,abc')
    expect(contract.signedAt).not.toBeNull()
  })

  it('rejects a second submit with the same token', async () => {
    const { token } = await issueSigningToken(contractId)
    await submitSignature(token, 'data:image/png;base64,abc')

    await expect(submitSignature(token, 'data:image/png;base64,def')).rejects.toThrow(AppError)
  })

  it('rejects an expired token', async () => {
    const { token } = await issueSigningToken(contractId)
    await prisma.signingToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } })

    await expect(submitSignature(token, 'data:image/png;base64,abc')).rejects.toThrow(AppError)
  })

  it('rejects an unknown token', async () => {
    await expect(submitSignature('unknown-token', 'data:image/png;base64,abc')).rejects.toThrow(AppError)
  })
})
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd server && npm test -- src/services/signingService.test.ts`
Expected: FAIL — `Cannot find module './signingService.js'`.

- [ ] **Step 6: Implement `signingService.ts`**

Create `server/src/services/signingService.ts`:

```ts
import crypto from 'crypto'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

const TOKEN_TTL_MS = 15 * 60 * 1000

export async function issueSigningToken(contractId: string): Promise<{ token: string; expiresAt: Date }> {
  const contract = await prisma.contract.findUnique({ where: { id: contractId } })
  if (!contract) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Contract ${contractId} not found`)
  }

  // "Staff can generate a fresh token at any time, invalidating the
  // previous one" — a Contract only ever has one live token, so reissuing
  // fully replaces whatever was there before, used or not.
  await prisma.signingToken.deleteMany({ where: { contractId } })

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
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd server && npm test -- src/services/signingService.test.ts`
Expected: PASS (all 9 tests).

- [ ] **Step 8: Commit**

```bash
git add server/prisma/models.prisma server/prisma/sqlite server/src/errors/errorCodes.ts server/src/services/signingService.ts server/src/services/signingService.test.ts
git commit -m "feat: add SigningToken model and signingService (issue/validate/submit)"
```

---

### Task 2: LAN IPv4 candidate detection

**Files:**
- Create: `server/src/network/lanNetwork.ts`
- Test: `server/src/network/lanNetwork.test.ts`

**Interfaces:**
- Consumes: Node's built-in `os` module.
- Produces: `LanCandidate { interfaceName: string; address: string }` and `detectLanCandidates(interfaces?: NodeJS.Dict<import('os').NetworkInterfaceInfo[]>): LanCandidate[]`. Consumed by Task 4 (the `sign-token` route, to report candidates to the desktop) and `server.ts` (to decide which addresses `signingApp` binds to).

- [ ] **Step 1: Write the failing tests**

Create `server/src/network/lanNetwork.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectLanCandidates } from './lanNetwork.js'

function iface(address: string, opts: { internal?: boolean; family?: 'IPv4' | 'IPv6' } = {}) {
  return [{
    address,
    netmask: '255.255.255.0',
    family: opts.family ?? 'IPv4',
    mac: '00:00:00:00:00:00',
    internal: opts.internal ?? false,
    cidr: `${address}/24`,
  }] as unknown as import('os').NetworkInterfaceInfo[]
}

describe('detectLanCandidates', () => {
  it('returns a private-range IPv4 interface', () => {
    const candidates = detectLanCandidates({ wlan0: iface('192.168.1.42') })
    expect(candidates).toEqual([{ interfaceName: 'wlan0', address: '192.168.1.42' }])
  })

  it('accepts all three RFC1918 ranges', () => {
    const candidates = detectLanCandidates({
      a: iface('10.0.0.5'),
      b: iface('172.20.0.5'),
      c: iface('192.168.0.5'),
    })
    expect(candidates.map((c) => c.address).sort()).toEqual(['10.0.0.5', '172.20.0.5', '192.168.0.5'])
  })

  it('excludes internal (loopback) interfaces', () => {
    const candidates = detectLanCandidates({ lo: iface('127.0.0.1', { internal: true }) })
    expect(candidates).toEqual([])
  })

  it('excludes IPv6 interfaces', () => {
    const candidates = detectLanCandidates({ eth0: iface('fe80::1', { family: 'IPv6' }) })
    expect(candidates).toEqual([])
  })

  it('excludes public (non-RFC1918) IPv4 addresses', () => {
    const candidates = detectLanCandidates({ eth0: iface('8.8.8.8') })
    expect(candidates).toEqual([])
  })

  it('excludes known virtual-adapter interface names', () => {
    const candidates = detectLanCandidates({
      docker0: iface('172.17.0.1'),
      veth1234: iface('172.17.0.2'),
      vmnet8: iface('192.168.100.1'),
      utun3: iface('192.168.99.1'),
    })
    expect(candidates).toEqual([])
  })

  it('returns multiple candidates when more than one qualifies', () => {
    const candidates = detectLanCandidates({ wlan0: iface('192.168.1.42'), eth0: iface('192.168.1.43') })
    expect(candidates).toHaveLength(2)
  })

  it('returns an empty array when nothing qualifies', () => {
    expect(detectLanCandidates({})).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npm test -- src/network/lanNetwork.test.ts`
Expected: FAIL — `Cannot find module './lanNetwork.js'`.

- [ ] **Step 3: Implement `lanNetwork.ts`**

Create `server/src/network/lanNetwork.ts`:

```ts
import os from 'os'

export interface LanCandidate {
  interfaceName: string
  address: string
}

// Interface-name patterns for adapters that are technically RFC1918 but
// aren't the shop's actual Wi-Fi/Ethernet LAN — Docker/virtualization
// bridges and VPN tunnel interfaces. A QR code pointed at one of these
// would produce an address the signing phone can never reach.
const VIRTUAL_ADAPTER_PATTERNS = [
  /docker/i,
  /veth/i,
  /vmnet/i,
  /vboxnet/i,
  /^utun/i,
  /^tun/i,
  /^tap/i,
  /wireguard/i,
  /^wg/i,
  /tailscale/i,
  /zerotier/i,
]

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false
  const [a, b] = parts
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

export function detectLanCandidates(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): LanCandidate[] {
  const candidates: LanCandidate[] = []
  for (const [name, infos] of Object.entries(interfaces)) {
    if (!infos) continue
    if (VIRTUAL_ADAPTER_PATTERNS.some((pattern) => pattern.test(name))) continue
    for (const info of infos) {
      if (info.family !== 'IPv4' || info.internal) continue
      if (!isPrivateIPv4(info.address)) continue
      candidates.push({ interfaceName: name, address: info.address })
    }
  }
  return candidates
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npm test -- src/network/lanNetwork.test.ts`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/network/lanNetwork.ts server/src/network/lanNetwork.test.ts
git commit -m "feat: add LAN IPv4 candidate detection for remote signing"
```

---

### Task 3: `signingApp` — the second, minimal Express app

**Files:**
- Create: `server/src/signingPage.ts`
- Create: `server/src/signingApp.ts`
- Test: `server/src/signingApp.test.ts`

**Interfaces:**
- Consumes: `checkTokenValidity`/`submitSignature` from `signingService.ts` (Task 1).
- Produces: `getSigningPageHtml(status: 'valid' | 'expired' | 'used' | 'not_found'): string` and `export const signingApp` (an Express app instance). Consumed by Task 4 (`server.ts`, to `.listen()` it on each LAN candidate).

- [ ] **Step 1: Write the failing route tests**

Create `server/src/signingApp.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { signingApp } from './signingApp.js'
import { prisma } from './db/client.js'
import { issueSigningToken } from './services/signingService.js'

let contractId: string

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  const staff = await prisma.staff.create({
    data: { name: 'S', login: `staff-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId: location.id },
  })
  const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@example.com' } })
  const contract = await prisma.contract.create({
    data: { number: 1, locationId: location.id, clientId: client.id, staffId: staff.id, eventDate: new Date('2026-10-03'), paymentMethod: 'PIX' },
  })
  contractId = contract.id
})

afterEach(async () => {
  await prisma.signingToken.deleteMany()
  await prisma.contract.deleteMany()
  await prisma.client.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('GET /sign/:token', () => {
  it('serves the signing page for a valid token', async () => {
    const { token } = await issueSigningToken(contractId)

    const response = await request(signingApp).get(`/sign/${token}`)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.text).toContain('<canvas')
  })

  it('serves an invalid-code message for an unknown token, without a canvas', async () => {
    const response = await request(signingApp).get('/sign/unknown-token')

    expect(response.status).toBe(200)
    expect(response.text).not.toContain('<canvas')
  })
})

describe('POST /sign/:token/submit', () => {
  it('accepts a valid signature submission', async () => {
    const { token } = await issueSigningToken(contractId)

    const response = await request(signingApp)
      .post(`/sign/${token}/submit`)
      .send({ signatureImage: 'data:image/png;base64,abc' })

    expect(response.status).toBe(200)
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } })
    expect(contract.signatureStatus).toBe('signed')
  })

  it('rejects a missing signatureImage with 400', async () => {
    const { token } = await issueSigningToken(contractId)

    const response = await request(signingApp).post(`/sign/${token}/submit`).send({})

    expect(response.status).toBe(400)
  })

  it('rejects a submit with an unknown token', async () => {
    const response = await request(signingApp)
      .post('/sign/unknown-token/submit')
      .send({ signatureImage: 'data:image/png;base64,abc' })

    expect(response.status).toBe(404)
  })
})

describe('exposed surface', () => {
  it('exposes no route other than /sign/:token and /sign/:token/submit', async () => {
    const response = await request(signingApp).get('/api/contracts')
    expect(response.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npm test -- src/signingApp.test.ts`
Expected: FAIL — `Cannot find module './signingApp.js'`.

- [ ] **Step 3: Implement `signingPage.ts`**

Create `server/src/signingPage.ts`:

```ts
function invalidMessage(status: 'expired' | 'used' | 'not_found'): string {
  if (status === 'expired') return 'Este código expirou. Peça um novo código à loja.'
  if (status === 'used') return 'Este código já foi utilizado. Peça um novo código à loja.'
  return 'Código inválido. Peça um novo código à loja.'
}

const STYLES = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px 16px; background: #faf6f0; color: #362a28; }
  h1 { font-size: 1.25rem; margin: 0 0 16px; }
  canvas { touch-action: none; width: 100%; max-width: 500px; height: 200px; border: 1px solid #e9dcd3; border-radius: 8px; background: white; display: block; }
  .actions { display: flex; gap: 8px; margin-top: 12px; max-width: 500px; }
  button { flex: 1; padding: 12px; border-radius: 8px; border: 1px solid #e9dcd3; background: white; font-size: 1rem; }
  button.primary { background: #b85c6e; color: white; border-color: #b85c6e; }
  button:disabled { opacity: 0.5; }
  .message { padding: 16px; border-radius: 8px; background: white; border: 1px solid #e9dcd3; max-width: 500px; }
  #status { margin-top: 8px; font-size: 0.9rem; color: #8c7a72; }
`

function signingBody(): string {
  return `
    <h1>Assinatura do Contrato</h1>
    <canvas id="pad"></canvas>
    <div class="actions">
      <button id="clear" type="button">Limpar</button>
      <button id="submit" class="primary" type="button">Enviar</button>
    </div>
    <p id="status"></p>
    <script>
      var canvas = document.getElementById('pad');
      var ctx = canvas.getContext('2d');
      canvas.width = 600;
      canvas.height = 200;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#362a28';
      var drawing = false;
      var hasDrawn = false;

      function pos(e) {
        var rect = canvas.getBoundingClientRect();
        var scaleX = canvas.width / rect.width;
        var scaleY = canvas.height / rect.height;
        return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
      }

      canvas.addEventListener('pointerdown', function (e) {
        drawing = true;
        hasDrawn = true;
        var p = pos(e);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
      });
      canvas.addEventListener('pointermove', function (e) {
        if (!drawing) return;
        var p = pos(e);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      });
      window.addEventListener('pointerup', function () { drawing = false; });

      document.getElementById('clear').addEventListener('click', function () {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasDrawn = false;
      });

      document.getElementById('submit').addEventListener('click', function () {
        var statusEl = document.getElementById('status');
        var submitBtn = document.getElementById('submit');
        if (!hasDrawn) {
          statusEl.textContent = 'Assine antes de enviar.';
          return;
        }
        submitBtn.disabled = true;
        statusEl.textContent = 'Enviando...';
        var signatureImage = canvas.toDataURL('image/png');
        fetch(window.location.pathname + '/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signatureImage: signatureImage }),
        })
          .then(function (response) {
            if (!response.ok) throw new Error('failed');
            document.body.innerHTML = '<div class="message"><p>Assinatura enviada! Pode devolver o aparelho à loja.</p></div>';
          })
          .catch(function () {
            statusEl.textContent = 'Erro ao enviar. Tente novamente.';
            submitBtn.disabled = false;
          });
      });
    </script>
  `
}

export function getSigningPageHtml(status: 'valid' | 'expired' | 'used' | 'not_found'): string {
  const body = status === 'valid' ? signingBody() : `<div class="message"><p>${invalidMessage(status)}</p></div>`

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Assinatura</title>
<style>${STYLES}</style>
</head>
<body>
${body}
</body>
</html>`
}
```

- [ ] **Step 4: Implement `signingApp.ts`**

Create `server/src/signingApp.ts`:

```ts
import express from 'express'
import { z } from 'zod'
import { AppError } from './errors/AppError.js'
import { ErrorCodes } from './errors/errorCodes.js'
import { errorMiddleware } from './errors/errorMiddleware.js'
import { checkTokenValidity, submitSignature } from './services/signingService.js'
import { getSigningPageHtml } from './signingPage.js'

export const signingApp = express()
signingApp.disable('x-powered-by')
signingApp.use(express.json({ limit: '1mb' }))

signingApp.get('/sign/:token', async (req, res) => {
  const status = await checkTokenValidity(req.params.token)
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(getSigningPageHtml(status))
})

const submitSchema = z.object({ signatureImage: z.string().min(1) })

signingApp.post('/sign/:token/submit', async (req, res) => {
  const parsed = submitSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid signature payload')
  }
  await submitSignature(req.params.token, parsed.data.signatureImage)
  res.json({ status: 'ok' })
})

signingApp.use(errorMiddleware)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && npm test -- src/signingApp.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/signingPage.ts server/src/signingApp.ts server/src/signingApp.test.ts
git commit -m "feat: add signingApp (unauthenticated GET/POST /sign/:token routes)"
```

---

### Task 4: Wire `signingApp` into `server.ts` + authenticated `POST /api/contracts/:id/sign-token`

**Files:**
- Modify: `server/src/server.ts`
- Modify: `server/src/routes/contracts.ts`
- Test: `server/tests/integration/happyPath.test.ts`

**Interfaces:**
- Consumes: `detectLanCandidates` (Task 2), `signingApp` (Task 3), `issueSigningToken` (Task 1).
- Produces: on the main `app`, `POST /api/contracts/:id/sign-token` → `201` with `{ token: string, expiresAt: string, port: number, candidates: { interfaceName: string, address: string }[] }`. Consumed by Task 5's client hook.

- [ ] **Step 1: Start `signingApp` alongside `app` in `server.ts`**

Read the current `server/src/server.ts` first — it's short. Replace its entire contents with:

```ts
import 'dotenv/config'
import { app } from './app.js'
import { signingApp } from './signingApp.js'
import { detectLanCandidates } from './network/lanNetwork.js'
import { runContractBackfill } from './services/contractBackfill.js'

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

await runContractBackfill()

const server = app.listen(port, host, () => {
  console.log(`Server listening on ${host}:${port}`)
})

// Node's http.Server fires 'listening' optimistically even when the
// underlying bind will shortly fail (e.g. EADDRINUSE from a leftover
// process still holding the port) — the real failure only surfaces on
// this separate 'error' event. Without a handler here, that event has
// nowhere to go and the process exits silently with no message at all,
// making a stale-process port collision indistinguishable from a clean
// shutdown. Fail loudly and with a nonzero code instead.
server.on('error', (error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})

// signingApp binds to each detected LAN candidate individually (never
// 0.0.0.0 — see the design's security boundary). A bind failure on one
// candidate (e.g. the interface disappeared between detection and bind)
// is logged, not fatal — remote signing on that address just won't work,
// but the rest of the app (including print, and signing on any other
// detected candidate) keeps running.
for (const candidate of detectLanCandidates()) {
  signingApp
    .listen(port, candidate.address, () => {
      console.log(`Signing app listening on ${candidate.address}:${port}`)
    })
    .on('error', (error) => {
      console.error(`Failed to start signing app on ${candidate.address}:${port}:`, error)
    })
}
```

- [ ] **Step 2: Add the `sign-token` route**

Modify `server/src/routes/contracts.ts` — update the imports at the top:

```ts
import { createContract, cancelContract, listContracts, getContract } from '../services/contractService.js'
import { issueSigningToken } from '../services/signingService.js'
import { detectLanCandidates } from '../network/lanNetwork.js'
```

Add this route at the end of the file, after the existing `POST /:id/cancel` handler:

```ts
contractsRouter.post('/:id/sign-token', async (req, res) => {
  const { token, expiresAt } = await issueSigningToken(req.params.id)
  res.status(201).json({
    token,
    expiresAt,
    port: Number(process.env.PORT ?? 3000),
    candidates: detectLanCandidates(),
  })
})
```

- [ ] **Step 3: Add an integration assertion**

Modify `server/tests/integration/happyPath.test.ts` — right after the `contractDetailResponse` block added in Plan 5 (the block asserting `client.name`/`location.name`/`allocations[0].product.name`), insert:

```ts
    const signTokenResponse = await auth(request(app).post(`/api/contracts/${contractResponse.body.id}/sign-token`))
    expect(signTokenResponse.status).toBe(201)
    expect(typeof signTokenResponse.body.token).toBe('string')
    expect(Array.isArray(signTokenResponse.body.candidates)).toBe(true)
```

Also update `afterAll`'s cleanup to include the new table — find:

```ts
  afterAll(async () => {
    await prisma.installment.deleteMany()
    await prisma.allocation.deleteMany()
    await prisma.contract.deleteMany()
    await prisma.product.deleteMany()
    await prisma.client.deleteMany()
    await prisma.staff.deleteMany()
    await prisma.location.deleteMany()
  })
```

and change it to:

```ts
  afterAll(async () => {
    await prisma.signingToken.deleteMany()
    await prisma.installment.deleteMany()
    await prisma.allocation.deleteMany()
    await prisma.contract.deleteMany()
    await prisma.product.deleteMany()
    await prisma.client.deleteMany()
    await prisma.staff.deleteMany()
    await prisma.location.deleteMany()
  })
```

- [ ] **Step 4: Run the tests**

Run: `cd server && npm test -- tests/integration/happyPath.test.ts`
Expected: PASS.

Then run the full server suite to confirm nothing else broke: `cd server && npm test`
Expected: PASS, all files.

- [ ] **Step 5: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/server.ts server/src/routes/contracts.ts server/tests/integration/happyPath.test.ts
git commit -m "feat: start signingApp on detected LAN candidates, add POST /api/contracts/:id/sign-token"
```

---

### Task 5: Client hooks + `qrcode` dependency + `useContract` polling option

**Files:**
- Modify: `client/package.json` (add `qrcode` dependency)
- Modify: `client/src/features/contracts/contractSchemas.ts`
- Modify: `client/src/features/contracts/useContracts.ts`
- Test: `client/src/features/contracts/useContracts.test.ts` (new file, if one doesn't already exist for this module — check first with `ls client/src/features/contracts/useContracts.test.ts`)

**Interfaces:**
- Consumes: `apiFetch` (`../../lib/api.ts`), `useMutation`/`useQuery` (`@tanstack/react-query`).
- Produces: `SigningTokenResponse` type, `LanCandidate` type, `useIssueSigningToken(): UseMutationResult<SigningTokenResponse, unknown, string>` (mutate with a contract id, returns the token response), and `useContract(id: string | undefined, options?: { refetchInterval?: number | false }): UseQueryResult<ContractDetail>`. Consumed by Task 6's `SignRemotelyModal`.

- [ ] **Step 1: Add the `qrcode` dependency**

Run: `cd client && npm install qrcode && npm install -D @types/qrcode`

Confirm `client/package.json`'s `dependencies` gained `"qrcode"` and `devDependencies` gained `"@types/qrcode"`.

- [ ] **Step 2: Add the new types**

Modify `client/src/features/contracts/contractSchemas.ts` — add these interfaces after `ContractDetail`:

```ts
export interface LanCandidate {
  interfaceName: string
  address: string
}

export interface SigningTokenResponse {
  token: string
  expiresAt: string
  port: number
  candidates: LanCandidate[]
}
```

- [ ] **Step 3: Extend `useContract` and add `useIssueSigningToken`**

Modify `client/src/features/contracts/useContracts.ts` — update the type import line:

```ts
import type { Contract, ContractDetail, NewContractFormValues, SigningTokenResponse } from './contractSchemas.ts'
```

Replace the existing `useContract` function:

```ts
export function useContract(id: string | undefined) {
  return useQuery({
    queryKey: [...CONTRACTS_KEY, id],
    queryFn: () => apiFetch<ContractDetail>(`/api/contracts/${id}`),
    enabled: id !== undefined,
  })
}
```

with:

```ts
export function useContract(id: string | undefined, options: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: [...CONTRACTS_KEY, id],
    queryFn: () => apiFetch<ContractDetail>(`/api/contracts/${id}`),
    enabled: id !== undefined,
    refetchInterval: options.refetchInterval,
  })
}
```

Add `useIssueSigningToken` after `useCancelContract`:

```ts
export function useIssueSigningToken() {
  return useMutation({
    mutationFn: (contractId: string) =>
      apiFetch<SigningTokenResponse>(`/api/contracts/${contractId}/sign-token`, { method: 'POST' }),
  })
}
```

- [ ] **Step 4: Verify existing consumers still typecheck**

`client/src/features/contracts/ContractPrintPage.tsx` calls `useContract(id)` with no second argument — confirm this still compiles (the new `options` parameter has a default value, so the call is unchanged).

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the existing contracts test suite**

Run: `cd client && npx vitest run src/features/contracts`
Expected: PASS — no existing test passes a second argument to `useContract`, and `ContractPrintPage.test.tsx`'s mock of `useContractsModule.useContract` still returns the same shape, so nothing here should break.

- [ ] **Step 6: Commit**

```bash
git add client/package.json client/package-lock.json client/src/features/contracts/contractSchemas.ts client/src/features/contracts/useContracts.ts
git commit -m "feat: add qrcode dependency, useIssueSigningToken, and useContract polling option"
```

---

### Task 6: `SignRemotelyModal` component

**Files:**
- Create: `client/src/features/contracts/SignRemotelyModal.tsx`
- Test: `client/src/features/contracts/SignRemotelyModal.test.tsx`
- Modify: `client/src/locales/pt-BR/contracts.json`

**Interfaces:**
- Consumes: `useIssueSigningToken`, `useContract` (Task 5), `Dialog`/`DialogContent`/`DialogTitle` (`../../components/ui/dialog.tsx`), `Button` (`../../components/ui/button.tsx`), `qrcode`'s `toDataURL`.
- Produces: `SignRemotelyModal({ contractId: string, open: boolean, onClose: () => void })`. Consumed by Task 7's `ContractsPage`.

- [ ] **Step 1: Add the signing translation keys**

Modify `client/src/locales/pt-BR/contracts.json` — add a `"sign"` key as a sibling of the existing `"print"` key:

```json
  "sign": {
    "action": "Assinar remotamente",
    "modalTitle": "Assinatura remota",
    "instructions": "Peça ao cliente para escanear o código com o celular.",
    "regenerate": "Gerar novo código",
    "noLan": "Nenhuma rede local detectada. Não é possível assinar remotamente neste momento.",
    "pickNetwork": "Rede",
    "waiting": "Aguardando assinatura...",
    "signed": "Assinado com sucesso!",
    "expired": "Código expirado.",
    "close": "Fechar"
  },
```

(Insert it directly after the `"print"` block, as another top-level sibling key — keep the file valid JSON.)

- [ ] **Step 2: Write the failing component test**

Create `client/src/features/contracts/SignRemotelyModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../i18n.ts'
import { SignRemotelyModal } from './SignRemotelyModal.tsx'
import * as useContractsModule from './useContracts.ts'
import type { Contract, SigningTokenResponse } from './contractSchemas.ts'

const unsignedContract: Contract = {
  id: 'ct1', number: 1, locationId: 'loc1', clientId: 'c1', staffId: 's1',
  eventDate: '2026-10-03', paymentMethod: 'PIX', signatureStatus: 'unsigned',
  signatureImage: null, signedAt: null, createdAt: '2026-09-01',
  allocations: [], installments: [],
}

const tokenResponse: SigningTokenResponse = {
  token: 'abc123',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  port: 3000,
  candidates: [{ interfaceName: 'wlan0', address: '192.168.1.42' }],
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient()
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function mockHooks(overrides: { contract?: Contract; issueImpl?: (...args: never[]) => Promise<SigningTokenResponse> } = {}) {
  vi.spyOn(useContractsModule, 'useContract').mockReturnValue({
    data: overrides.contract ?? unsignedContract,
  } as never)
  vi.spyOn(useContractsModule, 'useIssueSigningToken').mockReturnValue({
    mutateAsync: overrides.issueImpl ?? vi.fn().mockResolvedValue(tokenResponse),
    isPending: false,
  } as never)
}

describe('SignRemotelyModal', () => {
  beforeEach(() => {
    mockHooks()
  })

  it('issues a token and shows a QR code when opened', async () => {
    renderWithProviders(<SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('img', { name: /qr/i })).toBeInTheDocument())
  })

  it('shows the no-LAN message when there are no candidates', async () => {
    mockHooks({ issueImpl: vi.fn().mockResolvedValue({ ...tokenResponse, candidates: [] }) })

    renderWithProviders(<SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/Nenhuma rede local detectada/)).toBeInTheDocument())
  })

  it('shows a network picker when there is more than one candidate', async () => {
    mockHooks({
      issueImpl: vi.fn().mockResolvedValue({
        ...tokenResponse,
        candidates: [
          { interfaceName: 'wlan0', address: '192.168.1.42' },
          { interfaceName: 'eth0', address: '192.168.1.43' },
        ],
      }),
    })

    renderWithProviders(<SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByLabelText('Rede')).toBeInTheDocument())
  })

  it('shows a success state once the contract is signed', async () => {
    mockHooks({ contract: { ...unsignedContract, signatureStatus: 'signed' } })

    renderWithProviders(<SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Assinado com sucesso!')).toBeInTheDocument())
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd client && npx vitest run src/features/contracts/SignRemotelyModal.test.tsx`
Expected: FAIL — cannot find module `./SignRemotelyModal.tsx`.

- [ ] **Step 4: Implement `SignRemotelyModal`**

Create `client/src/features/contracts/SignRemotelyModal.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog.tsx'
import { Button } from '../../components/ui/button.tsx'
import { useContract, useIssueSigningToken } from './useContracts.ts'
import type { SigningTokenResponse } from './contractSchemas.ts'

const POLL_INTERVAL_MS = 3000

function buildSigningUrl(tokenResponse: SigningTokenResponse, address: string): string {
  return `http://${address}:${tokenResponse.port}/sign/${tokenResponse.token}`
}

interface SignRemotelyModalProps {
  contractId: string
  open: boolean
  onClose: () => void
}

export function SignRemotelyModal({ contractId, open, onClose }: SignRemotelyModalProps) {
  const { t } = useTranslation('contracts')
  const issueSigningToken = useIssueSigningToken()
  const { data: contract } = useContract(contractId, { refetchInterval: open ? POLL_INTERVAL_MS : false })

  const [tokenResponse, setTokenResponse] = useState<SigningTokenResponse | null>(null)
  const [selectedAddress, setSelectedAddress] = useState<string>('')
  const [qrDataUrl, setQrDataUrl] = useState<string>('')

  const isSigned = contract?.signatureStatus === 'signed'

  async function generateToken() {
    const response = await issueSigningToken.mutateAsync(contractId)
    setTokenResponse(response)
    setSelectedAddress(response.candidates[0]?.address ?? '')
  }

  useEffect(() => {
    if (open && !isSigned) {
      void generateToken()
    }
    if (!open) {
      setTokenResponse(null)
      setQrDataUrl('')
    }
    // Deliberately scoped to [open, contractId] only — this must fire once per
    // modal-open (or when switching to a different contract while a modal
    // instance is reused), not on every poll-triggered re-render of `contract`
    // or `isSigned`, which would keep reissuing the token and invalidating
    // whatever the phone is currently looking at.
  }, [open, contractId])

  useEffect(() => {
    if (!tokenResponse || !selectedAddress) {
      setQrDataUrl('')
      return
    }
    void QRCode.toDataURL(buildSigningUrl(tokenResponse, selectedAddress)).then(setQrDataUrl)
  }, [tokenResponse, selectedAddress])

  const isExpired = tokenResponse ? new Date(tokenResponse.expiresAt).getTime() < Date.now() : false

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-md gap-4">
        <DialogTitle className="text-base font-semibold text-ink">{t('sign.modalTitle')}</DialogTitle>

        {isSigned ? (
          <p className="text-sm text-ink">{t('sign.signed')}</p>
        ) : tokenResponse && tokenResponse.candidates.length === 0 ? (
          <p className="text-sm text-ink">{t('sign.noLan')}</p>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-muted-text">{t('sign.instructions')}</p>

            {tokenResponse && tokenResponse.candidates.length > 1 && (
              <label className="flex w-full flex-col gap-1 text-sm">
                {t('sign.pickNetwork')}
                <select
                  className="h-10 rounded-md border border-border-soft bg-white px-3 text-sm"
                  value={selectedAddress}
                  onChange={(event) => setSelectedAddress(event.target.value)}
                >
                  {tokenResponse.candidates.map((candidate) => (
                    <option key={candidate.address} value={candidate.address}>
                      {candidate.interfaceName} ({candidate.address})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {qrDataUrl && <img src={qrDataUrl} alt={t('sign.modalTitle') + ' QR'} className="h-48 w-48" />}

            {isExpired ? (
              <p className="text-sm text-red-600">{t('sign.expired')}</p>
            ) : (
              <p className="text-sm text-muted-text">{t('sign.waiting')}</p>
            )}

            <Button type="button" variant="secondary" onClick={() => void generateToken()} disabled={issueSigningToken.isPending}>
              {t('sign.regenerate')}
            </Button>
          </div>
        )}

        <Button type="button" variant="secondary" onClick={onClose}>
          {t('sign.close')}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd client && npx vitest run src/features/contracts/SignRemotelyModal.test.tsx`
Expected: PASS (all 4 tests).

- [ ] **Step 6: Commit**

```bash
git add client/src/features/contracts/SignRemotelyModal.tsx client/src/features/contracts/SignRemotelyModal.test.tsx client/src/locales/pt-BR/contracts.json
git commit -m "feat: add SignRemotelyModal (QR code, network picker, live polling)"
```

---

### Task 7: Wire "Assinar remotamente" into `ContractsPage`

**Files:**
- Modify: `client/src/features/contracts/ContractsPage.tsx`
- Modify: `client/src/features/contracts/ContractsPage.test.tsx`

**Interfaces:**
- Consumes: `SignRemotelyModal` (Task 6).
- Produces: nothing new for later tasks — this is the last task in the plan.

- [ ] **Step 1: Add the action to `ContractsPage`**

Modify `client/src/features/contracts/ContractsPage.tsx` — add the import:

```tsx
import { SignRemotelyModal } from './SignRemotelyModal.tsx'
```

Add a small per-row component after `ContractCancelAction`:

```tsx
function ContractSignAction({ contract }: { contract: Contract }) {
  const { t } = useTranslation('contracts')
  const [showModal, setShowModal] = useState(false)

  if (contract.signatureStatus === 'signed') return null

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setShowModal(true)}>
        {t('sign.action')}
      </Button>
      <SignRemotelyModal contractId={contract.id} open={showModal} onClose={() => setShowModal(false)} />
    </>
  )
}
```

Find the row header where `ContractCancelAction` is rendered (added in Plan 5, next to the "Imprimir" `Link`):

```tsx
              <div className="flex items-center gap-2">
                <Link
                  to={`/contratos/${contract.id}/imprimir`}
                  className="inline-flex h-8 items-center justify-center rounded-md border border-border-soft bg-white px-3 text-sm font-medium text-ink transition-colors hover:border-brand-300 hover:bg-brand-50"
                >
                  {t('print.action')}
                </Link>
                <ContractCancelAction contract={contract} />
              </div>
```

and change it to:

```tsx
              <div className="flex items-center gap-2">
                <Link
                  to={`/contratos/${contract.id}/imprimir`}
                  className="inline-flex h-8 items-center justify-center rounded-md border border-border-soft bg-white px-3 text-sm font-medium text-ink transition-colors hover:border-brand-300 hover:bg-brand-50"
                >
                  {t('print.action')}
                </Link>
                <ContractSignAction contract={contract} />
                <ContractCancelAction contract={contract} />
              </div>
```

- [ ] **Step 2: Update `ContractsPage.test.tsx`**

Modify `client/src/features/contracts/ContractsPage.test.tsx` — the existing `mockHooks` function needs to also mock the two new hooks `SignRemotelyModal` depends on, since `ContractSignAction` now renders unconditionally into every row (it just doesn't open the modal unless clicked). Update the `mockHooks` function:

```tsx
function mockHooks(overrides: { contracts?: Contract[]; cancelImpl?: (...args: never[]) => Promise<unknown> } = {}) {
  vi.spyOn(useContractsModule, 'useContractsList').mockReturnValue({
    data: overrides.contracts ?? [contract],
    isLoading: false,
  } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [{ id: 'p1', name: 'Vestido Azul' }] } as never)
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [{ id: 'c1', name: 'Maria' }] } as never)
  vi.spyOn(useContractsModule, 'useCancelContract').mockReturnValue({
    mutateAsync: overrides.cancelImpl ?? vi.fn(),
    isPending: false,
  } as never)
  vi.spyOn(useContractsModule, 'useContract').mockReturnValue({ data: overrides.contracts?.[0] ?? contract } as never)
  vi.spyOn(useContractsModule, 'useIssueSigningToken').mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ token: 't', expiresAt: new Date().toISOString(), port: 3000, candidates: [] }),
    isPending: false,
  } as never)
}
```

Add one new test at the end of the `describe('ContractsPage', ...)` block:

```tsx
  it('shows a sign-remotely action for an unsigned contract', () => {
    mockHooks()
    renderWithProviders(<ContractsPage />)
    expect(screen.getByRole('button', { name: 'Assinar remotamente' })).toBeInTheDocument()
  })

  it('hides the sign-remotely action once the contract is signed', () => {
    const signedContract: Contract = { ...contract, signatureStatus: 'signed' }
    mockHooks({ contracts: [signedContract] })
    renderWithProviders(<ContractsPage />)
    expect(screen.queryByRole('button', { name: 'Assinar remotamente' })).not.toBeInTheDocument()
  })
```

- [ ] **Step 3: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS, all files including `ContractsPage.test.tsx`.

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/features/contracts/ContractsPage.tsx client/src/features/contracts/ContractsPage.test.tsx
git commit -m "feat: add Assinar remotamente action to ContractsPage"
```

---

## Manual verification (after all tasks)

Start the app (server + client dev servers), create a contract, click "Assinar remotamente", confirm a QR code renders. From a phone on the same Wi-Fi network as the dev machine, scan the code (or manually visit the printed URL from another device on the LAN) and confirm the signing page loads with a draw-to-sign canvas, no external requests. Draw a signature and submit; confirm the desktop's modal automatically updates to the signed state within a few seconds (polling), and that the Contract's print view (`/contratos/:id/imprimir`) now shows the signature image in place of the blank line. Test the expired/regenerate path by waiting past 15 minutes or manually editing `expiresAt` in the DB, confirming the phone sees an "expired" message and the desktop's "Gerar novo código" issues a fresh, working code.
