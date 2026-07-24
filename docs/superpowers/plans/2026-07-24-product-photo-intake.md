# Product Photo Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff attach phone-taken photos to an already-saved product via a QR code (mirroring the existing remote-signing flow exactly), and speed up registering many similar products via "save and add another" + prefill-from-last-created.

**Architecture:** A new `ProductPhotoToken` model + `productPhotoTokenService.ts` mirror `SigningToken`/`signingService.ts` field-for-field. The existing LAN-bound `signingApp` gains two new routes (serves a vanilla-JS phone page, accepts the photo submission) rather than a third Express app. Photos are decoded from client-compressed base64 JPEG and written as real files under `PRODUCT_PHOTOS_DIR` (resolved the same way `DATABASE_URL`/`JWT_SECRET` already are), served back through a new authenticated route. Client mirrors `SignRemotelyModal.tsx` as `AddPhotosRemotelyModal.tsx`. `ProductDrawer.tsx` gains a "Salvar e adicionar outro" option and prefill state lifted to `ProductsPage.tsx`.

**Tech Stack:** Express + Prisma/SQLite (server), React 19 + react-hook-form + Zod (client), Vitest + Testing Library + supertest (unit/integration), Playwright (e2e). No new dependencies.

## Global Constraints

- No new server-side image-processing dependency — photos are compressed client-side (canvas draw + JPEG re-encode) before upload; the server only base64-decodes and writes bytes to disk.
- Reuse `signingApp`'s existing LAN-binding safety model exactly (never binds when `HOST=0.0.0.0`; `reachableSigningCandidates()`'s exact filtering logic applies the same way here) — do not create a third Express app.
- `ProductPhotoToken` is single-use, exactly like `SigningToken` (claimed atomically via `updateMany({where:{token,usedAt:null,expiresAt:{gt:now}}}`); reissuing a token for the same product deletes any existing unclaimed one for that product first.
- Multiple photos submit together in one request per token (not one photo per token).
- The remote-photo button/action is only available for an already-saved product (has an `id`) — never in create mode.
- "Last created" prefill state is in-memory/session-only (React state in `ProductsPage.tsx`), never persisted to localStorage, disk, or the database.
- The new photo-serving route stays behind `requireAuth` like every other `/api/products` route — since `<img src>` can't carry the app's `Authorization: Bearer` header, the client fetches photo bytes via an authenticated `fetch` and renders them through an object URL (`URL.createObjectURL`), not a bare `<img src="/api/...">`. This is a deliberate consistency choice: this codebase treats every `/api/*` route as auth-gated, and product photos aren't tied to a token the way signing images are — no exception is carved out here just for convenience.
- CSV bulk import and general photo-directory backup/durability are explicitly out of scope for this plan.

---

### Task 1: `ProductPhotoToken` Prisma model + migration

**Files:**
- Modify: `server/prisma/models.prisma` (add model, add relation field to `Product`)
- Create: a new migration under `server/prisma/migrations/` (via `db:migrate`)

**Interfaces:**
- Produces: `ProductPhotoToken { id, token (unique), productId, expiresAt, usedAt, createdAt }`, cascade-deletes with `Product`. Later tasks (`productPhotoTokenService.ts`) consume `prisma.productPhotoToken`.

- [ ] **Step 1: Add the model**

In `server/prisma/models.prisma`, add a `photoTokens ProductPhotoToken[]` relation field to the existing `Product` model (alongside its `allocations Product[]` line), and add the new model right after `SigningToken`:

```prisma
model Product {
  id            String   @id @default(uuid())
  locationId    String
  name          String
  description   String?
  category      String
  size          String
  color         String
  rentalPrice   Float
  depositAmount Float
  photos        String   @default("[]")
  status        String   @default("active")
  createdAt     DateTime @default(now())

  location    Location             @relation(fields: [locationId], references: [id])
  allocations Allocation[]
  photoTokens ProductPhotoToken[]
}
```

```prisma
model ProductPhotoToken {
  id         String    @id @default(uuid())
  token      String    @unique
  productId  String
  expiresAt  DateTime
  usedAt     DateTime?
  createdAt  DateTime  @default(now())

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `cd server && npm run db:migrate -- --name add_product_photo_token`
Expected: a new directory under `server/prisma/migrations/` is created, `prisma/sqlite/schema.prisma` is regenerated (via the existing `db:schema` prebuild step), and the command exits 0 with "Your database is now in sync with your schema."

- [ ] **Step 3: Run the full server suite to confirm nothing else broke**

Run: `cd server && npm test`
Expected: PASS — a schema-only addition shouldn't affect any existing test.

- [ ] **Step 4: Commit**

```bash
git add server/prisma/models.prisma server/prisma/migrations server/prisma/sqlite/schema.prisma
git commit -m "feat: add ProductPhotoToken model for remote photo intake"
```

---

### Task 2: `PRODUCT_PHOTOS_DIR` resolution

**Files:**
- Modify: `client/electron/main.ts` (add `resolveProductPhotosDir`, wire into the spawned server's `env`)
- Modify: `client/electron/main.test.ts` (test the new resolver)
- Modify: `server/.env.example` (document the new env var)

**Interfaces:**
- Produces: `resolveProductPhotosDir(userDataPath: string): string` — packaged Electron path resolution. Later tasks read `process.env.PRODUCT_PHOTOS_DIR` server-side (falling back to `./product-photos` when unset, for dev/test).

- [ ] **Step 1: Write the failing test**

Add to `client/electron/main.test.ts`, importing `resolveProductPhotosDir` alongside the existing imports (add it to the `import { ... } from './main.ts'` block at the top):

```ts
describe('resolveProductPhotosDir', () => {
  it('builds a path to a product-photos directory inside the given directory', () => {
    const userDataPath = '/home/user/.config/girovest'
    expect(resolveProductPhotosDir(userDataPath)).toBe(path.join(userDataPath, 'product-photos'))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd client && npx vitest run electron/main.test.ts`
Expected: FAIL — `resolveProductPhotosDir is not a function` (or a TypeScript import error).

- [ ] **Step 3: Implement the resolver and wire it into the spawned env**

In `client/electron/main.ts`, add the function right after `resolveDatabaseUrl`:

```ts
export function resolveProductPhotosDir(userDataPath: string): string {
  return path.join(userDataPath, 'product-photos')
}
```

Then add `PRODUCT_PHOTOS_DIR: resolveProductPhotosDir(userDataPath),` to the `env` object inside `startServer()`, alongside the existing `DATABASE_URL`/`JWT_SECRET` lines:

```ts
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DB_PROVIDER: 'sqlite',
    DATABASE_URL: resolveDatabaseUrl(userDataPath),
    JWT_SECRET: resolveJwtSecret(userDataPath),
    PRODUCT_PHOTOS_DIR: resolveProductPhotosDir(userDataPath),
    HOST: '127.0.0.1',
    PORT: '3000',
  }
```

- [ ] **Step 4: Document the env var**

Add to `server/.env.example`:

```
PRODUCT_PHOTOS_DIR=./product-photos
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd client && npx vitest run electron/main.test.ts`
Expected: PASS, including the new test and every pre-existing one in the file.

- [ ] **Step 6: Commit**

```bash
git add client/electron/main.ts client/electron/main.test.ts server/.env.example
git commit -m "feat: resolve PRODUCT_PHOTOS_DIR the same way DATABASE_URL/JWT_SECRET already are"
```

---

### Task 3: `productPhotoTokenService.ts`

**Files:**
- Create: `server/src/services/productPhotoTokenService.ts`
- Create: `server/src/services/productPhotoTokenService.test.ts`

**Interfaces:**
- Consumes: `prisma.productPhotoToken`, `prisma.product` (Task 1). `PRODUCT_PHOTOS_DIR` env var (Task 2), falling back to `./product-photos` when unset.
- Produces: `issueProductPhotoToken(productId: string, locationId: string): Promise<{token: string, expiresAt: Date}>`, `checkTokenValidity(token: string): Promise<'valid'|'expired'|'used'|'not_found'>`, `submitPhotos(token: string, photos: string[]): Promise<void>` — `photos` is an array of `data:image/jpeg;base64,...` strings. Later tasks (routes, Task 4) call all three directly.

- [ ] **Step 1: Write the failing tests**

```ts
// server/src/services/productPhotoTokenService.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import {
  issueProductPhotoToken,
  checkTokenValidity,
  submitPhotos,
} from './productPhotoTokenService.js'

let productId: string
let locationId: string
let photosDir: string
let originalPhotosDir: string | undefined

const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k='

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  locationId = location.id
  const product = await prisma.product.create({
    data: {
      locationId,
      name: 'P',
      category: 'festa',
      size: 'M',
      color: 'azul',
      rentalPrice: 100,
      depositAmount: 50,
    },
  })
  productId = product.id

  photosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-photos-test-'))
  originalPhotosDir = process.env.PRODUCT_PHOTOS_DIR
  process.env.PRODUCT_PHOTOS_DIR = photosDir
})

afterEach(async () => {
  process.env.PRODUCT_PHOTOS_DIR = originalPhotosDir
  fs.rmSync(photosDir, { recursive: true, force: true })
  await prisma.productPhotoToken.deleteMany()
  await prisma.allocation.deleteMany()
  await prisma.product.deleteMany()
  await prisma.location.deleteMany()
})

describe('issueProductPhotoToken', () => {
  it('creates a token expiring 15 minutes from now', async () => {
    const before = Date.now()
    const { token, expiresAt } = await issueProductPhotoToken(productId, locationId)

    expect(token.length).toBeGreaterThan(20)
    expect(expiresAt.getTime()).toBeGreaterThan(before + 14 * 60 * 1000)
    expect(expiresAt.getTime()).toBeLessThan(before + 16 * 60 * 1000)
  })

  it('invalidates a previously issued token for the same product', async () => {
    const first = await issueProductPhotoToken(productId, locationId)
    const second = await issueProductPhotoToken(productId, locationId)

    expect(await checkTokenValidity(first.token)).toBe('not_found')
    expect(await checkTokenValidity(second.token)).toBe('valid')
  })

  it('throws NOT_FOUND for a missing product', async () => {
    await expect(issueProductPhotoToken('missing-id', locationId)).rejects.toThrow(AppError)
  })

  it('throws NOT_FOUND for a product belonging to another location', async () => {
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'B' } })

    await expect(issueProductPhotoToken(productId, otherLocation.id)).rejects.toThrow(AppError)
  })

  it('does not delete an already-claimed token when reissuing', async () => {
    const { token } = await issueProductPhotoToken(productId, locationId)
    await submitPhotos(token, [TINY_JPEG])

    await issueProductPhotoToken(productId, locationId)

    const claimed = await prisma.productPhotoToken.findUnique({ where: { token } })
    expect(claimed).not.toBeNull()
    expect(claimed?.usedAt).not.toBeNull()
  })
})

describe('checkTokenValidity', () => {
  it('returns not_found for an unknown token', async () => {
    expect(await checkTokenValidity('unknown-token')).toBe('not_found')
  })

  it('returns expired for a token past its expiry', async () => {
    const { token } = await issueProductPhotoToken(productId, locationId)
    await prisma.productPhotoToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } })

    expect(await checkTokenValidity(token)).toBe('expired')
  })

  it('returns used for an already-consumed token', async () => {
    const { token } = await issueProductPhotoToken(productId, locationId)
    await submitPhotos(token, [TINY_JPEG])

    expect(await checkTokenValidity(token)).toBe('used')
  })
})

describe('submitPhotos', () => {
  it('writes photo files to PRODUCT_PHOTOS_DIR and appends their paths to the product', async () => {
    const { token } = await issueProductPhotoToken(productId, locationId)

    await submitPhotos(token, [TINY_JPEG, TINY_JPEG])

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } })
    const photos = JSON.parse(product.photos) as string[]
    expect(photos).toHaveLength(2)
    for (const relativePath of photos) {
      expect(fs.existsSync(path.join(photosDir, path.basename(relativePath)))).toBe(true)
    }
  })

  it('appends to existing photos rather than replacing them', async () => {
    await prisma.product.update({ where: { id: productId }, data: { photos: JSON.stringify(['existing.jpg']) } })
    const { token } = await issueProductPhotoToken(productId, locationId)

    await submitPhotos(token, [TINY_JPEG])

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } })
    const photos = JSON.parse(product.photos) as string[]
    expect(photos).toEqual(expect.arrayContaining(['existing.jpg']))
    expect(photos).toHaveLength(2)
  })

  it('marks the token used and rejects a second submit with the same token', async () => {
    const { token } = await issueProductPhotoToken(productId, locationId)
    await submitPhotos(token, [TINY_JPEG])

    await expect(submitPhotos(token, [TINY_JPEG])).rejects.toThrow(AppError)
  })

  it('rejects an expired token', async () => {
    const { token } = await issueProductPhotoToken(productId, locationId)
    await prisma.productPhotoToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } })

    await expect(submitPhotos(token, [TINY_JPEG])).rejects.toThrow(AppError)
  })

  it('rejects an unknown token', async () => {
    await expect(submitPhotos('unknown-token', [TINY_JPEG])).rejects.toThrow(AppError)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npm test -- productPhotoTokenService`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement the service**

```ts
// server/src/services/productPhotoTokenService.ts
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

const TOKEN_TTL_MS = 15 * 60 * 1000

function photosDir(): string {
  const dir = process.env.PRODUCT_PHOTOS_DIR ?? './product-photos'
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Constrained to exactly what the phone page's canvas.toDataURL('image/jpeg', ...)
// produces (mirrors signingApp's SIGNATURE_IMAGE_PATTERN reasoning) — this data
// ultimately gets base64-decoded and written to disk as a real file, so anything
// other than a well-formed JPEG data URL must be rejected before it ever reaches
// the filesystem.
const PHOTO_DATA_URL_PATTERN = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/

export async function issueProductPhotoToken(
  productId: string,
  locationId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product || product.locationId !== locationId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${productId} not found`)
  }

  // Same reissue rule as signingService.issueSigningToken: only ever one live
  // unclaimed token per product, and reissuing never deletes an already-claimed
  // row out from under a submitPhotos call that already claimed it.
  await prisma.productPhotoToken.deleteMany({ where: { productId, usedAt: null } })

  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)
  await prisma.productPhotoToken.create({ data: { token, productId, expiresAt } })
  return { token, expiresAt }
}

export async function checkTokenValidity(token: string): Promise<'valid' | 'expired' | 'used' | 'not_found'> {
  const photoToken = await prisma.productPhotoToken.findUnique({ where: { token } })
  if (!photoToken) return 'not_found'
  if (photoToken.usedAt) return 'used'
  if (photoToken.expiresAt.getTime() < Date.now()) return 'expired'
  return 'valid'
}

export async function submitPhotos(token: string, photos: string[]): Promise<void> {
  const now = new Date()

  // Atomic claim, identical reasoning to signingService.submitSignature: the
  // WHERE clause only matches an actually-valid, unclaimed token, and the
  // update itself is what claims it, so two concurrent submits with the same
  // token can never both succeed.
  const result = await prisma.productPhotoToken.updateMany({
    where: { token, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  })

  if (result.count === 0) {
    const status = await checkTokenValidity(token)
    if (status === 'not_found') {
      throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo token not found')
    }
    throw new AppError(ErrorCodes.PHOTO_TOKEN_INVALID, 410, `Photo token is ${status}`)
  }

  const photoToken = await prisma.productPhotoToken.findUniqueOrThrow({ where: { token } })
  const dir = photosDir()
  const writtenPaths: string[] = []
  for (const photo of photos) {
    const match = photo.match(PHOTO_DATA_URL_PATTERN)
    if (!match) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid photo payload')
    }
    const filename = `${crypto.randomUUID()}.jpg`
    fs.writeFileSync(path.join(dir, filename), Buffer.from(match[1], 'base64'))
    writtenPaths.push(filename)
  }

  const product = await prisma.product.findUniqueOrThrow({ where: { id: photoToken.productId } })
  const existingPhotos = JSON.parse(product.photos) as string[]
  await prisma.product.update({
    where: { id: photoToken.productId },
    data: { photos: JSON.stringify([...existingPhotos, ...writtenPaths]) },
  })
}
```

Check `server/src/errors/errorCodes.js` (source: `errorCodes.ts`) for the existing `SIGNING_TOKEN_INVALID` entry and add a sibling `PHOTO_TOKEN_INVALID` entry next to it, following its exact existing format.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npm test -- productPhotoTokenService`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/productPhotoTokenService.ts server/src/services/productPhotoTokenService.test.ts server/src/errors/errorCodes.ts
git commit -m "feat: add productPhotoTokenService mirroring signingService"
```

---

### Task 4: Server routes

**Files:**
- Modify: `server/src/routes/products.ts` (add `POST /:id/photo-token`, `GET /:id/photos/:filename`)
- Modify: `server/src/signingApp.ts` (add `GET /product-photos/:token`, `POST /product-photos/:token/submit`)
- Modify: `server/src/signingApp.test.ts` (test the two new routes)
- Modify: `server/src/routes/products.test.ts` (test the two new routes — check this file's actual current name/location first; if products routes aren't currently tested at the route layer, mirror `contracts.test.ts`'s route-level test style instead)

**Interfaces:**
- Consumes: `productPhotoTokenService.ts` (Task 3), `reachableSigningCandidates()` (already exists in `contracts.ts` — check whether to import/reuse it from there or duplicate the ~5-line function; since it's not currently exported from `contracts.ts`, export it and import it in `products.ts` rather than duplicating the LAN-safety logic in two places).
- Produces: `POST /api/products/:id/photo-token` returning `{token, expiresAt, port, candidates}` (same shape as the contract's sign-token response). `GET /api/products/:id/photos/:filename` streaming the raw JPEG bytes with `Content-Type: image/jpeg`. Later tasks (`AddPhotosRemotelyModal.tsx`, phone page) consume the token endpoint and the `signingApp` routes respectively; the client's authenticated-image hook (Task 6) consumes the photo-serving route.

- [ ] **Step 1: Export `reachableSigningCandidates` from `contracts.ts`**

In `server/src/routes/contracts.ts`, change `function reachableSigningCandidates()` to `export function reachableSigningCandidates()` (no other change to that function).

- [ ] **Step 2: Write the failing tests for `products.ts`'s new routes**

Add to `server/src/routes/products.test.ts` (or create it mirroring `contracts.test.ts`'s setup style if no route-level product test file exists yet — check first):

```ts
describe('POST /:id/photo-token', () => {
  it('issues a token for a product in the caller\'s own location', async () => {
    // ... create a product via the service/prisma directly, authenticate as staff
    // in that product's location, POST /api/products/:id/photo-token, assert 201
    // with { token, expiresAt, port, candidates }.
  })

  it('returns 404 for a product in another location', async () => {
    // ... product in a different location than the authenticated staff.
  })
})

describe('GET /:id/photos/:filename', () => {
  it('serves a photo file that was written to PRODUCT_PHOTOS_DIR', async () => {
    // ... write a real JPEG byte buffer to a temp PRODUCT_PHOTOS_DIR, request it
    // through the route, assert 200 and Content-Type: image/jpeg.
  })

  it('returns 404 for a nonexistent filename', async () => {
    // ...
  })

  it('rejects a filename containing path traversal characters with 400, not a filesystem read', async () => {
    // e.g. GET /api/products/:id/photos/..%2F..%2Fetc%2Fpasswd
  })
})
```

Write these against this repo's actual existing authenticated-route test setup pattern (check `contracts.test.ts` or `allocations.test.ts` for how a request gets an auth token/header in tests) rather than the sketch above — the sketch marks what must be asserted, not literal runnable code, since the auth harness needs to be copied from a real existing example.

- [ ] **Step 3: Run to verify failure**

Run: `cd server && npm test -- products`
Expected: FAIL — routes don't exist yet.

- [ ] **Step 4: Implement the routes**

In `server/src/routes/products.ts`, add imports and two new routes:

```ts
import fs from 'fs'
import path from 'path'
import { issueProductPhotoToken } from '../services/productPhotoTokenService.js'
import { reachableSigningCandidates } from './contracts.js'
```

```ts
productsRouter.post('/:id/photo-token', async (req, res) => {
  if (!req.staff) throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Unauthorized')
  const staff = await prisma.staff.findUniqueOrThrow({ where: { id: req.staff.staffId } })
  const { token, expiresAt } = await issueProductPhotoToken(req.params.id, staff.locationId)
  res.status(201).json({
    token,
    expiresAt,
    port: Number(process.env.PORT ?? 3000),
    candidates: reachableSigningCandidates(),
  })
})

// Filenames are always crypto.randomUUID() + '.jpg', generated only by
// productPhotoTokenService — this pattern rejects anything else (including
// path traversal) before it ever reaches the filesystem.
const PHOTO_FILENAME_PATTERN = /^[0-9a-f-]+\.jpg$/

productsRouter.get('/:id/photos/:filename', async (req, res) => {
  if (!PHOTO_FILENAME_PATTERN.test(req.params.filename)) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo not found')
  }
  const dir = process.env.PRODUCT_PHOTOS_DIR ?? './product-photos'
  const filePath = path.join(dir, req.params.filename)
  if (!fs.existsSync(filePath)) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo not found')
  }
  res.set('Content-Type', 'image/jpeg')
  res.sendFile(path.resolve(filePath))
})
```

(`products.ts` will need `import { prisma } from '../db/client.js'` if not already imported — check first.)

- [ ] **Step 5: Write the failing tests for `signingApp.ts`'s new routes**

Add to `server/src/signingApp.test.ts`, following the exact same `beforeEach`/`afterEach` setup already in that file but creating a `Product` instead of (or alongside) the existing `Contract` fixture:

```ts
describe('GET /product-photos/:token', () => {
  it('serves the photo intake page for a valid token', async () => {
    const { token } = await issueProductPhotoToken(productId, locationId)

    const response = await request(signingApp).get(`/product-photos/${token}`)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.text).toContain('type="file"')
  })

  it('serves an invalid-code message for an unknown token, without a file input', async () => {
    const response = await request(signingApp).get('/product-photos/unknown-token')

    expect(response.status).toBe(200)
    expect(response.text).not.toContain('type="file"')
  })
})

describe('POST /product-photos/:token/submit', () => {
  it('accepts a valid photo submission', async () => {
    const { token } = await issueProductPhotoToken(productId, locationId)

    const response = await request(signingApp)
      .post(`/product-photos/${token}/submit`)
      .send({ photos: ['data:image/jpeg;base64,abc'] })

    expect(response.status).toBe(200)
  })

  it('rejects a missing photos array with 400', async () => {
    const { token } = await issueProductPhotoToken(productId, locationId)

    const response = await request(signingApp).post(`/product-photos/${token}/submit`).send({})

    expect(response.status).toBe(400)
  })

  it('rejects a submit with an unknown token', async () => {
    const response = await request(signingApp)
      .post('/product-photos/unknown-token/submit')
      .send({ photos: ['data:image/jpeg;base64,abc'] })

    expect(response.status).toBe(404)
  })
})
```

Add the necessary `productId`/`locationId` fixture setup and `productPhotoToken`/`product` cleanup to this file's existing `beforeEach`/`afterEach`, and import `issueProductPhotoToken` from `./services/productPhotoTokenService.js`.

- [ ] **Step 6: Implement the `signingApp` routes**

In `server/src/signingApp.ts`, add imports and two new routes, following the exact same shape as the existing `/sign/:token` pair:

```ts
import { checkTokenValidity as checkSigningTokenValidity, submitSignature } from './services/signingService.js'
import {
  checkTokenValidity as checkPhotoTokenValidity,
  submitPhotos,
} from './services/productPhotoTokenService.js'
import { getSigningPageHtml } from './signingPage.js'
import { getProductPhotoPageHtml } from './productPhotoPage.js'
```

(Rename the existing `checkTokenValidity` import to `checkSigningTokenValidity` at the call site in the existing `/sign/:token` route too, to disambiguate from the new photo one.)

```ts
signingApp.get('/product-photos/:token', async (req, res) => {
  const status = await checkPhotoTokenValidity(req.params.token)
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(getProductPhotoPageHtml(status))
})

const submitPhotosSchema = z.object({
  photos: z.array(z.string().min(1)).min(1).max(10),
})

signingApp.post('/product-photos/:token/submit', async (req, res) => {
  const parsed = submitPhotosSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid photo payload')
  }
  await submitPhotos(req.params.token, parsed.data.photos)
  res.json({ status: 'ok' })
})
```

`getProductPhotoPageHtml` doesn't exist yet — Task 5 creates it; this task's tests for `GET /product-photos/:token` will fail until Task 5 lands. **Write Task 4's `signingApp.ts` route wiring now, but don't expect its GET-page test to go green until Task 5 is done** — the POST-submit tests, `products.ts` tests, and everything else in this task are independently completable and testable now.

Also raise `express.json({ limit: '1mb' })` on `signingApp` if the combined size of up to 10 compressed photos (each ~50-200KB per the spec) could exceed 1MB — change the limit to `'5mb'` on the single `signingApp.use(express.json({ limit: '5mb' }))` line (this raises the cap for the signature route too, which is harmless — signatures are far smaller than that ceiling).

- [ ] **Step 7: Run the `products.ts` and POST-submit `signingApp` tests to verify they pass**

Run: `cd server && npm test -- products signingApp`
Expected: `products.ts` tests PASS. `signingApp.ts`'s `POST /product-photos/:token/submit` tests PASS. The `GET /product-photos/:token` tests FAIL (expected — `getProductPhotoPageHtml` doesn't exist until Task 5) with a clear "not a function" style error, not a crash.

- [ ] **Step 8: Commit**

```bash
git add server/src/routes/products.ts server/src/routes/contracts.ts server/src/routes/products.test.ts server/src/signingApp.ts server/src/signingApp.test.ts
git commit -m "feat: add photo-token and photo-serving routes"
```

---

### Task 5: Phone page (`productPhotoPage.ts`)

**Files:**
- Create: `server/src/productPhotoPage.ts`
- Modify: `server/src/signingApp.test.ts` (the `GET /product-photos/:token` tests written in Task 4 should now pass)

**Interfaces:**
- Produces: `getProductPhotoPageHtml(status: 'valid'|'expired'|'used'|'not_found'): string` — consumed by `signingApp.ts`'s `GET /product-photos/:token` route (Task 4, already wired to import this).

- [ ] **Step 1: Implement the phone page**

Mirror `signingPage.ts`'s exact structure and style (same `invalidMessage` shape, same inline `<style>` block reusing the identical color palette, same vanilla-JS-no-framework approach) — but the interactive body is a multi-file picker with client-side canvas compression instead of a signature pad:

```ts
// server/src/productPhotoPage.ts
function invalidMessage(status: 'expired' | 'used' | 'not_found'): string {
  if (status === 'expired') return 'Este código expirou. Peça um novo código à loja.'
  if (status === 'used') return 'Este código já foi utilizado. Peça um novo código à loja.'
  return 'Código inválido. Peça um novo código à loja.'
}

const STYLES = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px 16px; background: #faf6f0; color: #362a28; }
  h1 { font-size: 1.25rem; margin: 0 0 16px; }
  input[type="file"] { display: block; width: 100%; max-width: 500px; padding: 12px; border: 1px solid #e9dcd3; border-radius: 8px; background: white; }
  .previews { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; max-width: 500px; }
  .previews img { height: 72px; width: 72px; object-fit: cover; border-radius: 8px; border: 1px solid #e9dcd3; }
  .actions { display: flex; gap: 8px; margin-top: 12px; max-width: 500px; }
  button { flex: 1; padding: 12px; border-radius: 8px; border: 1px solid #e9dcd3; background: white; font-size: 1rem; }
  button.primary { background: #b85c6e; color: white; border-color: #b85c6e; }
  button:disabled { opacity: 0.5; }
  .message { padding: 16px; border-radius: 8px; background: white; border: 1px solid #e9dcd3; max-width: 500px; }
  #status { margin-top: 8px; font-size: 0.9rem; color: #8c7a72; }
`

const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.7

function photoIntakeBody(): string {
  return `
    <h1>Fotos do Produto</h1>
    <input id="file-input" type="file" accept="image/*" capture="environment" multiple />
    <div class="previews" id="previews"></div>
    <div class="actions">
      <button id="submit" class="primary" type="button" disabled>Enviar</button>
    </div>
    <p id="status"></p>
    <script>
      var fileInput = document.getElementById('file-input');
      var previews = document.getElementById('previews');
      var submitBtn = document.getElementById('submit');
      var statusEl = document.getElementById('status');
      var compressedPhotos = [];

      function compress(file) {
        return new Promise(function (resolve, reject) {
          var img = new Image();
          img.onload = function () {
            var scale = Math.min(1, ${MAX_DIMENSION} / Math.max(img.width, img.height));
            var canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', ${JPEG_QUALITY}));
          };
          img.onerror = reject;
          img.src = URL.createObjectURL(file);
        });
      }

      fileInput.addEventListener('change', function () {
        var files = Array.prototype.slice.call(fileInput.files);
        statusEl.textContent = 'Processando fotos...';
        Promise.all(files.map(compress)).then(function (dataUrls) {
          compressedPhotos = dataUrls;
          previews.innerHTML = '';
          dataUrls.forEach(function (dataUrl) {
            var img = document.createElement('img');
            img.src = dataUrl;
            previews.appendChild(img);
          });
          submitBtn.disabled = compressedPhotos.length === 0;
          statusEl.textContent = compressedPhotos.length + ' foto(s) pronta(s) para enviar.';
        });
      });

      submitBtn.addEventListener('click', function () {
        if (compressedPhotos.length === 0) return;
        submitBtn.disabled = true;
        statusEl.textContent = 'Enviando...';
        fetch(window.location.pathname + '/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photos: compressedPhotos }),
        })
          .then(function (response) {
            if (!response.ok) throw new Error('failed');
            document.body.innerHTML = '<div class="message"><p>Fotos enviadas! Pode devolver o aparelho à loja.</p></div>';
          })
          .catch(function () {
            statusEl.textContent = 'Erro ao enviar. Tente novamente.';
            submitBtn.disabled = false;
          });
      });
    </script>
  `
}

export function getProductPhotoPageHtml(status: 'valid' | 'expired' | 'used' | 'not_found'): string {
  const body = status === 'valid' ? photoIntakeBody() : `<div class="message"><p>${invalidMessage(status)}</p></div>`

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Fotos do Produto</title>
<style>${STYLES}</style>
</head>
<body>
${body}
</body>
</html>`
}
```

- [ ] **Step 2: Run the `signingApp.ts` tests to verify the previously-failing GET tests now pass**

Run: `cd server && npm test -- signingApp`
Expected: PASS — all tests in the file, including the `GET /product-photos/:token` ones written in Task 4 that were failing until now.

- [ ] **Step 3: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/productPhotoPage.ts
git commit -m "feat: add vanilla-JS phone page for product photo intake"
```

---

### Task 6: Client `AddPhotosRemotelyModal.tsx` + authenticated image display

**Files:**
- Create: `client/src/features/products/AddPhotosRemotelyModal.tsx`
- Create: `client/src/features/products/AddPhotosRemotelyModal.test.tsx`
- Create: `client/src/lib/useAuthenticatedImageUrl.ts`
- Create: `client/src/lib/useAuthenticatedImageUrl.test.ts`
- Modify: `client/src/features/products/useProducts.ts` (add `useIssueProductPhotoToken`)
- Modify: `client/src/features/products/productSchemas.ts` (add `PhotoTokenResponse` type)
- Modify: `client/src/features/products/ProductDrawer.tsx` (wire in the new button + authenticated photo thumbnails, replacing the plain `<img src={url}>`)
- Modify: `client/src/locales/pt-BR/products.json` (new `photoIntake.*` keys mirroring `contracts.json`'s `sign.*` block)

**Interfaces:**
- Consumes: `POST /api/products/:id/photo-token` (Task 4), `GET /api/products/:id/photos/:filename` (Task 4).
- Produces: `useAuthenticatedImageUrl(path: string | null): string | null` — a small hook any photo-displaying component can reuse; `AddPhotosRemotelyModal` component, wired into `ProductDrawer.tsx`.

- [ ] **Step 1: Add the `PhotoTokenResponse` type**

In `client/src/features/products/productSchemas.ts`, add (mirroring `SigningTokenResponse` in `contractSchemas.ts` — check its exact shape first and match it field-for-field):

```ts
export interface PhotoTokenResponse {
  token: string
  expiresAt: string
  port: number
  candidates: { interfaceName: string; address: string }[]
}
```

- [ ] **Step 2: Add `useIssueProductPhotoToken`**

In `client/src/features/products/useProducts.ts`, add (mirroring `useContracts.ts`'s `useIssueSigningToken` — check its exact implementation first and match its query-invalidation behavior):

```ts
import type { PhotoTokenResponse } from './productSchemas.ts'

export function useIssueProductPhotoToken() {
  return useMutation({
    mutationFn: (productId: string) =>
      apiFetch<PhotoTokenResponse>(`/api/products/${productId}/photo-token`, { method: 'POST' }),
  })
}
```

- [ ] **Step 3: Write the failing test for `useAuthenticatedImageUrl`**

```ts
// client/src/lib/useAuthenticatedImageUrl.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAuthenticatedImageUrl } from './useAuthenticatedImageUrl.ts'

const originalFetch = global.fetch
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

afterEach(() => {
  global.fetch = originalFetch
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
  vi.restoreAllMocks()
})

describe('useAuthenticatedImageUrl', () => {
  it('returns null when given a null path', () => {
    const { result } = renderHook(() => useAuthenticatedImageUrl(null))
    expect(result.current).toBeNull()
  })

  it('fetches the path with auth headers and returns an object URL', async () => {
    const blob = new Blob(['fake-image-bytes'])
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })
    URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-url')
    URL.revokeObjectURL = vi.fn()

    const { result } = renderHook(() => useAuthenticatedImageUrl('/api/products/p1/photos/x.jpg'))

    await waitFor(() => expect(result.current).toBe('blob:fake-url'))
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/products/p1/photos/x.jpg'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Bearer /) }) }),
    )
  })

  it('revokes the previous object URL when the path changes', async () => {
    const blob = new Blob(['a'])
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })
    URL.createObjectURL = vi.fn().mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:two')
    URL.revokeObjectURL = vi.fn()

    const { result, rerender } = renderHook(({ path }) => useAuthenticatedImageUrl(path), {
      initialProps: { path: '/api/products/p1/photos/a.jpg' },
    })
    await waitFor(() => expect(result.current).toBe('blob:one'))

    rerender({ path: '/api/products/p1/photos/b.jpg' })
    await waitFor(() => expect(result.current).toBe('blob:two'))

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:one')
  })
})
```

Check `client/src/lib/api.ts` first for how the auth token is currently read (likely `localStorage` — match its exact key/read mechanism) before writing the hook, so the test's `Authorization` header expectation matches reality.

- [ ] **Step 4: Run it to verify it fails**

Run: `cd client && npx vitest run src/lib/useAuthenticatedImageUrl.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 5: Implement the hook**

```ts
// client/src/lib/useAuthenticatedImageUrl.ts
import { useEffect, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

export function useAuthenticatedImageUrl(path: string | null): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!path) {
      setObjectUrl(null)
      return
    }
    let cancelled = false
    let created: string | null = null
    const token = localStorage.getItem('token')
    fetch(`${API_BASE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((response) => {
        if (!response.ok) throw new Error('failed to fetch image')
        return response.blob()
      })
      .then((blob) => {
        if (cancelled) return
        created = URL.createObjectURL(blob)
        setObjectUrl(created)
      })
      .catch(() => {
        if (!cancelled) setObjectUrl(null)
      })
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [path])

  return objectUrl
}
```

Check `client/src/lib/api.ts` for the exact `localStorage` key name used for the token (it may not literally be `'token'`) and correct the hook to match before running tests.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd client && npx vitest run src/lib/useAuthenticatedImageUrl.test.ts`
Expected: PASS.

- [ ] **Step 7: Add locale strings**

In `client/src/locales/pt-BR/products.json`, add a `photoIntake` block mirroring `contracts.json`'s `sign` block:

```json
  "photoIntake": {
    "action": "Adicionar fotos remotamente",
    "modalTitle": "Fotos remotas",
    "instructions": "Peça para escanear o código com o celular para enviar fotos.",
    "regenerate": "Gerar novo código",
    "qrAlt": "Código QR para envio de fotos",
    "noLan": "Nenhuma rede local detectada. Não é possível enviar fotos remotamente neste momento.",
    "pickNetwork": "Rede",
    "waiting": "Aguardando fotos...",
    "close": "Fechar"
  }
```

- [ ] **Step 8: Write the failing tests for `AddPhotosRemotelyModal`**

Mirror `SignRemotelyModal.test.tsx` closely (QR issuance on open, no-LAN state, network picker, regenerate, stop-polling-on-close) — but there's no "signed" terminal state to test here the way `SignRemotelyModal` has (photo intake doesn't have a single boolean "done" state the way signing does; polling just keeps refreshing the product's photo count). Write these tests against `AddPhotosRemotelyModal`'s actual props once Step 9 defines them.

- [ ] **Step 9: Implement `AddPhotosRemotelyModal.tsx`**

Mirror `SignRemotelyModal.tsx`'s structure exactly, polling `useProducts()` (the existing list hook, not a new per-product hook) with `refetchInterval` while open, deriving the current product via `.find()`:

```tsx
// client/src/features/products/AddPhotosRemotelyModal.tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog.tsx'
import { Button } from '../../components/ui/button.tsx'
import { useProducts, useIssueProductPhotoToken } from './useProducts.ts'
import type { PhotoTokenResponse } from './productSchemas.ts'

const POLL_INTERVAL_MS = 3000

function buildPhotoUrl(tokenResponse: PhotoTokenResponse, address: string): string {
  return `http://${address}:${tokenResponse.port}/product-photos/${tokenResponse.token}`
}

interface AddPhotosRemotelyModalProps {
  productId: string
  open: boolean
  onClose: () => void
}

export function AddPhotosRemotelyModal({ productId, open, onClose }: AddPhotosRemotelyModalProps) {
  const { t } = useTranslation('products')
  const issueToken = useIssueProductPhotoToken()
  const { data: products } = useProducts({ refetchInterval: open ? POLL_INTERVAL_MS : false } as never)
  const product = products?.find((p) => p.id === productId)

  const [tokenResponse, setTokenResponse] = useState<PhotoTokenResponse | null>(null)
  const [selectedAddress, setSelectedAddress] = useState<string>('')
  const [qrDataUrl, setQrDataUrl] = useState<string>('')

  async function generateToken() {
    setTokenResponse(null)
    setQrDataUrl('')
    const response = await issueToken.mutateAsync(productId)
    setTokenResponse(response)
    setSelectedAddress(response.candidates[0]?.address ?? '')
  }

  useEffect(() => {
    if (open) {
      void generateToken()
    } else {
      setTokenResponse(null)
      setQrDataUrl('')
    }
    // Deliberately scoped to [open, productId] only, same reasoning as
    // SignRemotelyModal — must not reissue on every poll-triggered re-render.
  }, [open, productId])

  useEffect(() => {
    if (!tokenResponse || !selectedAddress) {
      setQrDataUrl('')
      return
    }
    let cancelled = false
    void QRCode.toDataURL(buildPhotoUrl(tokenResponse, selectedAddress)).then((dataUrl) => {
      if (!cancelled) setQrDataUrl(dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [tokenResponse, selectedAddress])

  const isExpired = tokenResponse ? new Date(tokenResponse.expiresAt).getTime() < Date.now() : false

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-md gap-4" showCloseButton={false}>
        <DialogTitle className="text-base font-semibold text-ink">{t('photoIntake.modalTitle')}</DialogTitle>

        {tokenResponse && tokenResponse.candidates.length === 0 ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-ink">{t('photoIntake.noLan')}</p>
            <Button type="button" variant="secondary" onClick={() => void generateToken()} disabled={issueToken.isPending}>
              {t('photoIntake.regenerate')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-muted-text">{t('photoIntake.instructions')}</p>

            {tokenResponse && tokenResponse.candidates.length > 1 && (
              <label className="flex w-full flex-col gap-1 text-sm">
                {t('photoIntake.pickNetwork')}
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

            {qrDataUrl && <img src={qrDataUrl} alt={t('photoIntake.qrAlt')} className="h-48 w-48" />}

            {isExpired ? (
              <p className="text-sm text-red-600">{t('sign.expired', { ns: 'contracts' })}</p>
            ) : (
              <p className="text-sm text-muted-text">
                {t('photoIntake.waiting')} ({product?.photos?.length ?? 0})
              </p>
            )}

            <Button type="button" variant="secondary" onClick={() => void generateToken()} disabled={issueToken.isPending}>
              {t('photoIntake.regenerate')}
            </Button>
          </div>
        )}

        <Button type="button" variant="secondary" onClick={onClose}>
          {t('photoIntake.close')}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
```

Check `useProducts()`'s actual current signature before assuming it accepts a `refetchInterval` option — per the research, it currently takes no arguments at all (`useQuery({queryKey: PRODUCTS_KEY, queryFn: ...})`), so it needs a small signature change to accept an optional `{ refetchInterval?: number | false }` param and pass it through to the underlying `useQuery` options, mirroring how `useContract(id, {refetchInterval})` already does this in `useContracts.ts`. Update `useProducts.ts`'s existing `useProducts()` export accordingly and check every other current caller of `useProducts()` (there are several: `CalendarPage.tsx`, `ProductsPage.tsx`) still works when called with no argument (the new param must be optional and default to no polling, preserving current behavior everywhere else).

Fix the `t('sign.expired', {ns:'contracts'})` cross-namespace lookup above if it turns out awkward in practice — an equally valid alternative is a dedicated `photoIntake.expired` key in `products.json` instead of reaching into `contracts.json`'s namespace; prefer the dedicated key, it's cleaner and avoids a cross-feature i18n coupling. Use `"expired": "Código expirado."` under `photoIntake` in Step 7 instead, and reference `t('photoIntake.expired')` here.

- [ ] **Step 10: Wire `AddPhotosRemotelyModal` and authenticated thumbnails into `ProductDrawer.tsx`**

Add a new button visible only in edit mode (`product` is non-null), and replace the plain `<img src={url}>` in the existing photos list with the authenticated hook:

```tsx
import { AddPhotosRemotelyModal } from './AddPhotosRemotelyModal.tsx'
import { useAuthenticatedImageUrl } from '../../lib/useAuthenticatedImageUrl.ts'
```

```tsx
function PhotoThumbnail({ url }: { url: string }) {
  const isRemotePath = url.startsWith('/api/')
  const authenticatedUrl = useAuthenticatedImageUrl(isRemotePath ? url : null)
  return <img src={isRemotePath ? (authenticatedUrl ?? '') : url} alt="" className="h-8 w-8 rounded object-cover" />
}
```

Replace `<img src={url} alt="" className="h-8 w-8 rounded object-cover" />` (existing line) with `<PhotoThumbnail url={url} />`. Add `const [addingPhotosRemotely, setAddingPhotosRemotely] = useState(false)` alongside the drawer's other `useState` calls, and render:

```tsx
{product && (
  <Button type="button" variant="secondary" onClick={() => setAddingPhotosRemotely(true)}>
    {t('photoIntake.action')}
  </Button>
)}
```

placed near the existing photos section, plus:

```tsx
{product && (
  <AddPhotosRemotelyModal
    productId={product.id}
    open={addingPhotosRemotely}
    onClose={() => setAddingPhotosRemotely(false)}
  />
)}
```

- [ ] **Step 11: Run all new/changed tests, then the full client suite**

Run: `cd client && npx vitest run src/lib/useAuthenticatedImageUrl.test.ts src/features/products/AddPhotosRemotelyModal.test.tsx src/features/products/ProductDrawer.test.tsx`
Expected: PASS.

Run: `cd client && npm test`
Expected: PASS — including every existing caller of `useProducts()` (`CalendarPage.test.tsx`, `ProductsPage.test.tsx` if it exists) still passing after that hook's signature changed to accept an optional argument.

- [ ] **Step 12: Commit**

```bash
git add client/src/features/products/AddPhotosRemotelyModal.tsx client/src/features/products/AddPhotosRemotelyModal.test.tsx client/src/lib/useAuthenticatedImageUrl.ts client/src/lib/useAuthenticatedImageUrl.test.ts client/src/features/products/useProducts.ts client/src/features/products/productSchemas.ts client/src/features/products/ProductDrawer.tsx client/src/locales/pt-BR/products.json
git commit -m "feat: add remote photo intake modal and authenticated photo thumbnails"
```

---

### Task 7: "Save and add another" + duplicate-from-last

**Files:**
- Modify: `client/src/features/products/ProductsPage.tsx` (lift `lastCreatedDefaults` state)
- Modify: `client/src/features/products/ProductDrawer.tsx` (new prop, new button, reset-on-continue behavior)
- Modify: `client/src/features/products/ProductDrawer.test.tsx`
- Modify: `client/src/locales/pt-BR/products.json` (new `actions.saveAndAddAnother` key)

**Interfaces:**
- Produces: `ProductDrawer`'s prop signature gains `duplicateDefaults?: Partial<ProductFormValues>` and `onCreated?: (values: ProductFormValues) => void`. Consumed by `ProductsPage.tsx`, which owns the actual `lastCreatedDefaults` state.

- [ ] **Step 1: Write the failing tests**

Add to `client/src/features/products/ProductDrawer.test.tsx`:

```tsx
it('prefills category/size/color/price/deposit from duplicateDefaults, leaving name and photos blank', () => {
  mockProductHooks(vi.fn())
  renderWithToast(
    <ProductDrawer
      product={null}
      onClose={vi.fn()}
      duplicateDefaults={{ category: 'festa', size: 'M', color: 'azul', rentalPrice: 200, depositAmount: 100 }}
    />,
  )

  expect(screen.getByLabelText('Categoria')).toHaveValue('festa')
  expect(screen.getByLabelText('Tamanho')).toHaveValue('M')
  expect(screen.getByLabelText('Cor')).toHaveValue('azul')
  expect(screen.getByLabelText('Nome')).toHaveValue('')
})

it('calls onCreated with the saved values and stays open when "Salvar e adicionar outro" is used', async () => {
  const onClose = vi.fn()
  const onCreated = vi.fn()
  const createImpl = vi.fn().mockResolvedValue(undefined)
  mockProductHooks(vi.fn(), createImpl)
  renderWithToast(<ProductDrawer product={null} onClose={onClose} onCreated={onCreated} />)

  await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
  await userEvent.type(screen.getByLabelText('Categoria'), 'festa')
  await userEvent.type(screen.getByLabelText('Tamanho'), 'M')
  await userEvent.type(screen.getByLabelText('Cor'), 'verde')
  await userEvent.click(screen.getByRole('button', { name: 'Salvar e adicionar outro' }))

  expect(createImpl).toHaveBeenCalled()
  expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ category: 'festa', size: 'M', color: 'verde' }))
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Nome')).toHaveValue('')
})

it('does not show "Salvar e adicionar outro" in edit mode', () => {
  mockProductHooks(vi.fn())
  renderWithToast(<ProductDrawer product={product} onClose={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Salvar e adicionar outro' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx vitest run src/features/products/ProductDrawer.test.tsx`
Expected: FAIL — new prop/button don't exist.

- [ ] **Step 3: Implement in `ProductDrawer.tsx`**

Add `duplicateDefaults`/`onCreated` to the props, use `duplicateDefaults` in `useForm`'s `defaultValues` when creating, and track submit intent to decide whether to call `onClose()` or reset-and-stay-open:

```tsx
export function ProductDrawer({
  product,
  onClose,
  duplicateDefaults,
  onCreated,
}: {
  product: Product | null
  onClose: () => void
  duplicateDefaults?: Partial<ProductFormValues>
  onCreated?: (values: ProductFormValues) => void
}) {
  // ...
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: product ?? {
      locationId: staff?.locationId ?? '',
      name: '', category: duplicateDefaults?.category ?? '', size: duplicateDefaults?.size ?? '',
      color: duplicateDefaults?.color ?? '', rentalPrice: duplicateDefaults?.rentalPrice ?? 0,
      depositAmount: duplicateDefaults?.depositAmount ?? 0, description: duplicateDefaults?.description,
    },
  })

  const [keepOpenAfterSave, setKeepOpenAfterSave] = useState(false)

  async function onSubmit(values: ProductFormValues) {
    try {
      if (product) {
        await updateProduct.mutateAsync({ id: product.id, values: { ...values, status, photos } })
        onClose()
      } else {
        await createProduct.mutateAsync({ ...values, photos })
        onCreated?.(values)
        if (keepOpenAfterSave) {
          setPhotos([])
          reset({
            locationId: staff?.locationId ?? '',
            name: '', category: values.category, size: values.size, color: values.color,
            rentalPrice: values.rentalPrice, depositAmount: values.depositAmount, description: values.description,
          })
        } else {
          onClose()
        }
      }
    } catch (error) {
      showError(error)
    }
  }
```

Add the second button next to the existing "Salvar" one:

```tsx
{!product && (
  <Button
    type="submit"
    variant="secondary"
    onClick={() => setKeepOpenAfterSave(true)}
    disabled={createProduct.isPending}
  >
    {t('common:actions.saveAndAddAnother', { ns: 'common' })}
  </Button>
)}
<Button type="submit" onClick={() => setKeepOpenAfterSave(false)} disabled={createProduct.isPending || updateProduct.isPending}>
  {t('common:actions.save', { ns: 'common' })}
</Button>
```

Both buttons have `type="submit"` and set `keepOpenAfterSave` via `onClick` before the form's native submit fires on the same click — this is the standard pattern for "two submit intents, one form."

- [ ] **Step 4: Add the locale key**

Check `client/src/locales/pt-BR/common.json` for where `actions.save`/`actions.cancel` live and add a sibling:

```json
"saveAndAddAnother": "Salvar e adicionar outro"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd client && npx vitest run src/features/products/ProductDrawer.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire `lastCreatedDefaults` state into `ProductsPage.tsx`**

```tsx
const [lastCreatedDefaults, setLastCreatedDefaults] = useState<Partial<ProductFormValues> | null>(null)
```

Pass into `ProductDrawer`:

```tsx
<ProductDrawer
  key={editing?.id ?? 'new'}
  product={editing}
  onClose={() => setEditing(undefined)}
  duplicateDefaults={editing === null ? (lastCreatedDefaults ?? undefined) : undefined}
  onCreated={(values) =>
    setLastCreatedDefaults({
      category: values.category, size: values.size, color: values.color,
      rentalPrice: values.rentalPrice, depositAmount: values.depositAmount, description: values.description,
    })
  }
/>
```

Add a test to `ProductsPage.test.tsx` (check whether this file currently exists — if not, this is the first test for the page; write it following `CalendarPage.test.tsx`'s mocking style for `useProducts`) confirming: after simulating a create via the drawer's `onCreated` callback path, opening a fresh "Novo" shows the remembered category/size/color prefilled.

- [ ] **Step 7: Run the full client suite**

Run: `cd client && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src/features/products/ProductsPage.tsx client/src/features/products/ProductDrawer.tsx client/src/features/products/ProductDrawer.test.tsx client/src/locales/pt-BR/common.json
git commit -m "feat: add save-and-add-another with prefill from the last created product"
```

---

### Task 8: E2E regression test

**Files:**
- Create: `client/e2e/product-photo-intake.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-7, plus the real authenticated `/api/products/:id/photo-token` endpoint (tokens are runtime-generated, not seedable — this test issues one through the real API rather than a seed script).

- [ ] **Step 1: Write the test**

```ts
// client/e2e/product-photo-intake.spec.ts
import { test, expect } from '@playwright/test'

// Precondition: server/ is running against a database seeded via
// `npx tsx seed-e2e.ts` (see server/README.md).

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByLabel('Usuário').fill('e2e-staff')
  await page.getByLabel('Senha').fill('e2e-password12')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Painel — hoje')).toBeVisible()
}

test('save and add another keeps the drawer open and prefills the next product', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: 'Produtos' }).click()
  await page.getByRole('button', { name: 'Novo' }).click()

  await page.getByLabel('Nome').fill('Vestido Intake E2E 1')
  await page.getByLabel('Categoria').fill('festa')
  await page.getByLabel('Tamanho').fill('M')
  await page.getByLabel('Cor').fill('azul')
  await page.getByRole('button', { name: 'Salvar e adicionar outro' }).click()

  await expect(page.getByLabel('Nome')).toHaveValue('')
  await expect(page.getByLabel('Categoria')).toHaveValue('festa')
  await expect(page.getByLabel('Cor')).toHaveValue('azul')

  await page.getByLabel('Nome').fill('Vestido Intake E2E 2')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Vestido Intake E2E 2')).toBeVisible()
})

test('remote photo intake: scanning the QR and submitting a photo updates the drawer', async ({ page, context }) => {
  await login(page)
  await page.getByRole('link', { name: 'Produtos' }).click()
  await page.getByRole('button', { name: 'Novo' }).click()
  await page.getByLabel('Nome').fill('Vestido Foto E2E')
  await page.getByLabel('Categoria').fill('festa')
  await page.getByLabel('Tamanho').fill('M')
  await page.getByLabel('Cor').fill('azul')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await page.getByText('Vestido Foto E2E').click()

  await page.getByRole('button', { name: 'Adicionar fotos remotamente' }).click()
  const qrImg = await page.getByRole('img', { name: /fotos/i })
  await expect(qrImg).toBeVisible()

  // Extract the real LAN URL by issuing a token through the same authenticated
  // API the modal itself just called, rather than decoding the QR image pixel
  // data — mirrors how remote contract signing was manually verified.
  const token = await page.evaluate(async () => {
    const authToken = localStorage.getItem('token')
    const productsResponse = await fetch('http://localhost:3000/api/products', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
    const products = await productsResponse.json()
    const product = products.find((p: { name: string }) => p.name === 'Vestido Foto E2E')
    const tokenResponse = await fetch(`http://localhost:3000/api/products/${product.id}/photo-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    })
    const { token: t } = await tokenResponse.json()
    return t
  })

  const phonePage = await context.newPage()
  await phonePage.goto(`http://localhost:3000/product-photos/${token}`)
  await expect(phonePage.locator('input[type="file"]')).toBeVisible()

  // A tiny valid 1x1 JPEG for the file input.
  await phonePage.setInputFiles('input[type="file"]', {
    name: 'test.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
      'base64',
    ),
  })
  await expect(phonePage.getByRole('button', { name: 'Enviar' })).toBeEnabled()
  await phonePage.getByRole('button', { name: 'Enviar' }).click()
  await expect(phonePage.getByText('Fotos enviadas!')).toBeVisible()

  // Back on the desktop, polling should surface the new photo count.
  await expect(page.getByText(/\(1\)/)).toBeVisible({ timeout: 10_000 })
})
```

- [ ] **Step 2: Run it**

Ensure `server/` is running (`cd server && npm run dev &`, confirm with `curl http://localhost:3000/health`) and seeded (`cd server && npx tsx seed-e2e.ts`), then:

Run: `cd client && npx playwright test product-photo-intake.spec.ts --reporter=line`
Expected: both tests PASS. If the photo count assertion's exact text format doesn't match what `AddPhotosRemotelyModal.tsx` actually renders (the plan's Task 6 code renders `({product?.photos?.length ?? 0})` as part of the waiting-state paragraph), adjust the assertion's selector/regex to match the real rendered text rather than changing the component to match a guessed assertion.

- [ ] **Step 3: Commit**

```bash
git add client/e2e/product-photo-intake.spec.ts
git commit -m "test: e2e coverage for remote photo intake and save-and-add-another"
```

## Self-Review

**Spec coverage:** All six spec decisions are covered — `ProductPhotoToken` (Task 1), `PRODUCT_PHOTOS_DIR` resolution (Task 2), the service/routes/phone-page mirroring signing (Tasks 3-5), `AddPhotosRemotelyModal` (Task 6), save-and-add-another + duplicate-from-last (Task 7), and e2e verification (Task 8). The authenticated-image-display constraint (not in the original spec, discovered during research since `<img src>` can't carry the Bearer header) is resolved via `useAuthenticatedImageUrl` and stated as a Global Constraint.

**Placeholder scan:** No TBD/TODO. Two spots intentionally hand judgment to the implementer rather than guessing exact repo details that must be read fresh: the auth-test-harness pattern for Task 4's route tests (existing example must be copied, not invented) and the `localStorage` key name for the auth token in Task 6 (must be confirmed against `api.ts`, not assumed) — both are marked as "check first" rather than silently guessed, which is the correct call given neither was directly read during this planning pass with full certainty preserved into the final draft.

**Type consistency:** `ProductPhotoToken`'s fields (`token`, `productId`, `expiresAt`, `usedAt`) are identical across Task 1 (schema), Task 3 (service + tests), and Task 4 (routes) call sites. `PhotoTokenResponse`'s shape (`token`, `expiresAt`, `port`, `candidates`) matches between Task 6's schema addition and Task 6/8's usage. `ProductDrawer`'s new `duplicateDefaults`/`onCreated` props have matching types between Task 7's `ProductDrawer.tsx` change and `ProductsPage.tsx`'s usage.
