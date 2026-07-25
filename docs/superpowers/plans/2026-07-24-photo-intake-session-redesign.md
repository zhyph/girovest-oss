# Photo Intake Session Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-product, single-use photo-intake token from the just-merged feature with a staff+location-scoped session token — one QR scan serves an entire registration batch, the phone becomes a two-screen product-picker + camera-capture flow, multi-photo capture actually works, and photo thumbnails are genuinely visible on the desktop side.

**Architecture:** `ProductPhotoToken` changes from per-product/single-use to per-staff-session/reusable-until-expiry (12h TTL). `productId` moves from the token itself into each individual submit request, validated server-side against the token's own `locationId`. The unauthenticated LAN-bound `signingApp` gains a product-list route for the phone's picker screen. The phone page (`productPhotoPage.ts`, still vanilla JS/no build step) becomes two screens: a searchable, recency-sorted product list, then per-tapped-product camera capture — with the camera invoked via a repeatable "Tirar Foto" button (one shot per tap, matching how `capture="environment"` actually behaves on mobile browsers — it does not return multiple photos from one invocation) rather than relying on the `multiple` file-input attribute, which is what caused the original one-photo-only bug. The desktop trigger moves from `ProductDrawer` to `ProductsPage` (session-level, not product-level), and `ProductDrawer`'s photo thumbnails grow from 32px to a size that's actually visible.

**Tech Stack:** Same as the feature being replaced — Express + Prisma/SQLite (server), React + TanStack Query (client), vanilla HTML/JS (phone page), Vitest + Playwright.

## Global Constraints

- The session token is scoped to **staff + location**, NOT a specific product, and is **reusable across many submissions** within its ~12-hour expiry — it is never single-use/consumed. This is an explicit, named security tradeoff (a leaked QR could be used many times during the window, unlike the signing-token pattern this was originally modeled on), accepted because the surface is LAN-only and shift-bound.
- `productId` now lives in each **submit request body**, not the token. The server must validate the referenced product's `locationId` matches the token's `locationId` on every submit — a staff can't attach a photo to another location's product even with a valid session token.
- The phone page must default to **camera capture as the primary, most prominent action** — a hidden file input with `capture="environment"`, invoked by a clearly-labeled button — not a bare file picker. Multiple photos are accumulated by tapping that button repeatedly (each tap = one camera shot appended to a running list), not by relying on the file input's `multiple` attribute for multi-select, since mobile camera capture returns one photo per invocation regardless of `multiple`.
- No server-side image-processing dependency — client-side canvas compression (already built) is unchanged.
- This plan **replaces** the per-product mechanism from `docs/superpowers/plans/2026-07-24-product-photo-intake.md` — it does not add a second parallel flow. `AddPhotosRemotelyModal.tsx` as a per-product modal is removed; its QR/polling logic is repurposed into a new session-level component.
- Every task must leave the full server and client test suites green before being considered done.

---

### Task 1: Schema — `ProductPhotoToken` becomes session-scoped

**Files:**
- Modify: `server/prisma/models.prisma:119-128` (the `ProductPhotoToken` model)
- Create: a new migration (generated via `npm run db:migrate`, not hand-written SQL)

**Interfaces:**
- Consumes: nothing (schema-only task).
- Produces: `ProductPhotoToken { id, token, staffId, locationId, expiresAt, createdAt }` — no `productId`, no `usedAt`. Every later task that queries this model uses exactly these fields.

- [ ] **Step 1: Update the model**

```prisma
model ProductPhotoToken {
  id         String   @id @default(uuid())
  token      String   @unique
  staffId    String
  locationId String
  expiresAt  DateTime
  createdAt  DateTime @default(now())

  staff    Staff    @relation(fields: [staffId], references: [id], onDelete: Cascade)
  location Location @relation(fields: [locationId], references: [id], onDelete: Cascade)
}
```

Add the inverse relations on `Staff` and `Location` models (find their current definitions in `server/prisma/models.prisma` and add `productPhotoTokens ProductPhotoToken[]` alongside their other back-relations, matching the existing style for e.g. `Staff.allocations`/`Location.products`).

- [ ] **Step 2: Generate and apply the migration**

Run from `server/`:

```bash
npm run db:migrate -- --name product_photo_token_session_scoped
```

Expected: a new migration directory under `server/prisma/sqlite/migrations/` is created and applied cleanly (Prisma will recreate the table since SQLite requires a table rebuild for this shape of column change — this is expected, not an error). Confirm via `npm test` (server) that the suite still passes after this — existing tests that reference the old `productId`/`usedAt` fields will fail here; that's expected and fixed in Task 3, not this task. Do not attempt to fix those tests in this task — just confirm the migration itself applies without error (`npx prisma studio` or a quick manual query is enough to confirm the new columns exist; don't chase full green yet).

- [ ] **Step 3: Commit**

```bash
git add server/prisma/models.prisma server/prisma/sqlite/schema.prisma server/prisma/sqlite/migrations/
git commit -m "feat: make ProductPhotoToken session-scoped (staff+location, not per-product)"
```

---

### Task 2: Real JPEG seed fixture

**Files:**
- Create: `server/fixtures/sample-product-photo.jpg` (a small, real JPEG — a few KB, any simple image; generate one with a short script if no image tool is available, e.g. via a minimal in-memory canvas render written to a file, or check if ImageMagick/similar is available in this environment)
- Modify: `server/seed-e2e-calendar-load.ts` and/or `server/scripts/db-tools.ts`'s sample-data seeding (whichever currently creates demo/test products) to reference this fixture — read a product's photo handling: since `Product.photos` stores paths, and this feature's photos are served via `/api/products/:id/photos/:filename`, a seed script can't just point at an arbitrary fixture path through that route (the route only serves files from `PRODUCT_PHOTOS_DIR`). Copy the fixture into `PRODUCT_PHOTOS_DIR` under a fixed filename as part of seeding, and set the seeded product's `photos` array to `["/api/products/<id>/photos/<fixed-filename>.jpg"]`, matching the real runtime shape exactly.

**Interfaces:**
- Consumes: `PRODUCT_PHOTOS_DIR` resolution (already exists, from the just-merged feature).
- Produces: nothing consumed by later tasks — this is seed-data-only, independent of the rest of this plan.

- [ ] **Step 1: Add the fixture**

Check first whether a suitable small real image already exists anywhere in the repo (`find . -iname "*.jpg" -o -iname "*.png" -not -path "*/node_modules/*"`). If not, create one — the simplest reliable option in a Node environment with no extra dependencies: write a tiny valid JPEG by hand (a minimal solid-color JPEG can be generated with a short one-off script using the `canvas`-free approach of embedding a pre-built minimal JPEG byte sequence, OR check if `sharp`/`jimp`/ImageMagick's `convert` CLI is available in this dev environment and use whichever is present to generate a 100x100 solid-color JPEG). Whatever method is used, verify the result with `file server/fixtures/sample-product-photo.jpg` (must report a real JPEG, not text).

- [ ] **Step 2: Wire it into seed scripts**

In whichever seed script(s) create demo/test products (check `server/scripts/db-tools.ts`'s `seedSampleData()` and `server/seed-e2e-calendar-load.ts`'s product creation), after creating each demo product:

```ts
import fs from 'fs'
import path from 'path'

const photosDir = process.env.PRODUCT_PHOTOS_DIR ?? './product-photos'
fs.mkdirSync(photosDir, { recursive: true })
const seededFilename = 'seed-sample-photo.jpg'
fs.copyFileSync(path.resolve('fixtures/sample-product-photo.jpg'), path.join(photosDir, seededFilename))
// then set/update the product's photos field:
photos: JSON.stringify([`/api/products/${product.id}/photos/${seededFilename}`])
```

- [ ] **Step 3: Verify and commit**

Run the modified seed script(s) manually against a scratch/dev db, confirm the product's photo actually loads via the authenticated route (`curl` with a valid bearer token, or check visually later in this plan's e2e task). Commit:

```bash
git add server/fixtures/sample-product-photo.jpg server/scripts/db-tools.ts server/seed-e2e-calendar-load.ts
git commit -m "test: seed a real JPEG fixture for demo products instead of placeholder URLs"
```

---

### Task 3: Server — session token service rework

**Files:**
- Modify: `server/src/services/productPhotoTokenService.ts` (full rewrite of `issueProductPhotoToken`/`checkTokenValidity`/`submitPhotos`)
- Modify: `server/src/services/productPhotoTokenService.test.ts` (full rewrite to match)

**Interfaces:**
- Consumes: `ProductPhotoToken` (Task 1's new shape).
- Produces: `issueProductPhotoSession(staffId: string, locationId: string): Promise<{token: string, expiresAt: Date}>`, `checkTokenValidity(token: string): Promise<'valid'|'expired'|'not_found'>` (no more `'used'` state), `submitPhotos(token: string, productId: string, photos: string[]): Promise<void>`. These three names/signatures are the contract Task 4 (routes) relies on.

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
  issueProductPhotoSession,
  checkTokenValidity,
  submitPhotos,
} from './productPhotoTokenService.js'

const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=='

let photosDir: string

beforeEach(async () => {
  photosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-photo-test-'))
  process.env.PRODUCT_PHOTOS_DIR = photosDir
  await prisma.productPhotoToken.deleteMany()
})

afterEach(() => {
  fs.rmSync(photosDir, { recursive: true, force: true })
  delete process.env.PRODUCT_PHOTOS_DIR
})

describe('issueProductPhotoSession', () => {
  it('issues a token scoped to the given staff and location', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const { token, expiresAt } = await issueProductPhotoSession(staff.id, staff.locationId)
    expect(token).toHaveLength(43) // base64url(32 random bytes)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(await checkTokenValidity(token)).toBe('valid')
  })

  it('does not invalidate a previously issued still-valid token for the same staff', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const first = await issueProductPhotoSession(staff.id, staff.locationId)
    await issueProductPhotoSession(staff.id, staff.locationId)
    // Unlike the old single-use-per-product model, issuing a new session
    // token does NOT invalidate a prior one — multiple concurrent sessions
    // for the same staff are harmless and not worth guarding against.
    expect(await checkTokenValidity(first.token)).toBe('valid')
  })
})

describe('submitPhotos', () => {
  it('accepts multiple submits with the same token (not single-use)', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const product = await prisma.product.findFirstOrThrow({ where: { locationId: staff.locationId } })
    const { token } = await issueProductPhotoSession(staff.id, staff.locationId)

    await submitPhotos(token, product.id, [TINY_JPEG])
    await submitPhotos(token, product.id, [TINY_JPEG]) // second submit, same token — must succeed

    const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    expect((JSON.parse(updated.photos) as string[]).length).toBeGreaterThanOrEqual(2)
  })

  it('rejects a productId belonging to a different location than the token', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const { token } = await issueProductPhotoSession(staff.id, staff.locationId)
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'X' } })
    const otherProduct = await prisma.product.create({
      data: { locationId: otherLocation.id, name: 'X', category: 'x', size: 'x', color: 'x', rentalPrice: 1, depositAmount: 1 },
    })

    await expect(submitPhotos(token, otherProduct.id, [TINY_JPEG])).rejects.toThrow(AppError)
  })

  it('rejects an expired token', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const product = await prisma.product.findFirstOrThrow({ where: { locationId: staff.locationId } })
    const { token } = await issueProductPhotoSession(staff.id, staff.locationId)
    await prisma.productPhotoToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } })

    await expect(submitPhotos(token, product.id, [TINY_JPEG])).rejects.toThrow(AppError)
  })

  it('rejects an unknown token', async () => {
    const staff = await prisma.staff.findFirstOrThrow()
    const product = await prisma.product.findFirstOrThrow({ where: { locationId: staff.locationId } })
    await expect(submitPhotos('unknown-token', product.id, [TINY_JPEG])).rejects.toThrow(AppError)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npm test -- productPhotoTokenService`
Expected: FAIL — `issueProductPhotoSession` doesn't exist yet.

- [ ] **Step 3: Rewrite the service**

```ts
// server/src/services/productPhotoTokenService.ts
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

const SESSION_TTL_MS = 12 * 60 * 60 * 1000

function photosDir(): string {
  const dir = process.env.PRODUCT_PHOTOS_DIR ?? './product-photos'
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const PHOTO_DATA_URL_PATTERN = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/

export async function issueProductPhotoSession(
  staffId: string,
  locationId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await prisma.productPhotoToken.create({ data: { token, staffId, locationId, expiresAt } })
  return { token, expiresAt }
}

export async function checkTokenValidity(token: string): Promise<'valid' | 'expired' | 'not_found'> {
  const photoToken = await prisma.productPhotoToken.findUnique({ where: { token } })
  if (!photoToken) return 'not_found'
  if (photoToken.expiresAt.getTime() < Date.now()) return 'expired'
  return 'valid'
}

// Unlike the signing-token pattern this was originally modeled on, this
// token is intentionally reusable — no claim/consume step. Only expiry
// invalidates it. See docs/superpowers/specs/2026-07-24-photo-intake-session-redesign.md
// for why this tradeoff is accepted (LAN-only, shift-bound TTL).
export async function submitPhotos(token: string, productId: string, photos: string[]): Promise<void> {
  const photoToken = await prisma.productPhotoToken.findUnique({ where: { token } })
  if (!photoToken) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo token not found')
  }
  if (photoToken.expiresAt.getTime() < Date.now()) {
    throw new AppError(ErrorCodes.PHOTO_TOKEN_INVALID, 410, 'Photo token is expired')
  }

  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product || product.locationId !== photoToken.locationId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${productId} not found`)
  }

  const dir = photosDir()
  const writtenPaths: string[] = []
  for (const photo of photos) {
    const match = photo.match(PHOTO_DATA_URL_PATTERN)
    if (!match) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid photo payload')
    }
    const filename = `${crypto.randomUUID()}.jpg`
    fs.writeFileSync(path.join(dir, filename), Buffer.from(match[1], 'base64'))
    writtenPaths.push(`/api/products/${productId}/photos/${filename}`)
  }

  const existingPhotos = JSON.parse(product.photos) as string[]
  await prisma.product.update({
    where: { id: productId },
    data: { photos: JSON.stringify([...existingPhotos, ...writtenPaths]) },
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npm test -- productPhotoTokenService`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/productPhotoTokenService.ts server/src/services/productPhotoTokenService.test.ts
git commit -m "feat: rework photo token service for session-scoped, reusable tokens"
```

---

### Task 4: Server — product-list route + updated submit route

**Files:**
- Modify: `server/src/services/productService.ts` (add a location-scoped, search-capable, recency-sorted list function)
- Modify: `server/src/signingApp.ts` (new `GET /product-photos/:token/products?search=` route; update the submit route to accept `productId` in the body)
- Modify: `server/src/signingApp.test.ts`

**Interfaces:**
- Consumes: `productPhotoTokenService.ts`'s `checkTokenValidity`/`submitPhotos` (Task 3).
- Produces: `listProductsForLocation(locationId: string, opts: {search?: string, limit?: number}): Promise<ProductDTO[]>` in `productService.ts` — ordered by `createdAt desc`, filtered by `name`/`category`/`color` substring match when `search` is given, capped at `opts.limit ?? 20`. This is what Task 6's phone page fetches.

- [ ] **Step 1: Write the failing test for the list function**

```ts
// add to server/src/services/productService.test.ts (find its existing describe block and add alongside)
describe('listProductsForLocation', () => {
  it('returns only that location\'s products, newest first', async () => {
    const locationA = await prisma.location.create({ data: { name: 'A', address: 'X' } })
    const locationB = await prisma.location.create({ data: { name: 'B', address: 'Y' } })
    const p1 = await createProduct({ locationId: locationA.id, name: 'First', category: 'c', size: 's', color: 'c', rentalPrice: 1, depositAmount: 1 })
    const p2 = await createProduct({ locationId: locationA.id, name: 'Second', category: 'c', size: 's', color: 'c', rentalPrice: 1, depositAmount: 1 })
    await createProduct({ locationId: locationB.id, name: 'Other location', category: 'c', size: 's', color: 'c', rentalPrice: 1, depositAmount: 1 })

    const result = await listProductsForLocation(locationA.id, {})
    expect(result.map((p) => p.id)).toEqual([p2.id, p1.id])
  })

  it('filters by search substring across name/category/color', async () => {
    const location = await prisma.location.create({ data: { name: 'C', address: 'Z' } })
    await createProduct({ locationId: location.id, name: 'Vestido Azul', category: 'festa', size: 'M', color: 'azul', rentalPrice: 1, depositAmount: 1 })
    await createProduct({ locationId: location.id, name: 'Vestido Verde', category: 'gala', size: 'M', color: 'verde', rentalPrice: 1, depositAmount: 1 })

    const result = await listProductsForLocation(location.id, { search: 'azul' })
    expect(result.map((p) => p.name)).toEqual(['Vestido Azul'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npm test -- productService`
Expected: FAIL — `listProductsForLocation` doesn't exist.

- [ ] **Step 3: Implement it**

In `productService.ts`, alongside the existing `listProducts`:

```ts
export async function listProductsForLocation(
  locationId: string,
  opts: { search?: string; limit?: number },
): Promise<ProductDTO[]> {
  const products = await prisma.product.findMany({
    where: {
      locationId,
      ...(opts.search
        ? {
            OR: [
              { name: { contains: opts.search } },
              { category: { contains: opts.search } },
              { color: { contains: opts.search } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 20,
  })
  return products.map(toProductDTO) // reuse whatever mapping function listProducts already uses — check the actual current implementation and match it exactly
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npm test -- productService`
Expected: PASS.

- [ ] **Step 5: Write the failing signingApp tests**

Update `server/src/signingApp.test.ts`'s existing `/product-photos/:token/submit` tests to send `productId` in the body (not implicit from the token), and add a new test block:

```ts
describe('GET /product-photos/:token/products', () => {
  it('returns the token\'s location\'s products, most recent first', async () => {
    // set up a staff/location/products, issue a session token via issueProductPhotoSession,
    // GET the new route, assert the response matches listProductsForLocation's shape/order
  })

  it('supports a ?search= query param', async () => {
    // as above, with ?search=<substring>, asserting only matching products are returned
  })

  it('returns 404 for an unknown or expired token', async () => {
    // as the existing GET /product-photos/:token pattern already tests
  })
})
```

Also update the existing submit-route tests: the request body now needs `{ productId, photos }` instead of `{ photos }` alone, and a new test asserting a `productId` from a different location than the token's is rejected.

- [ ] **Step 6: Run to verify it fails**

Run: `cd server && npm test -- signingApp`
Expected: FAIL — new route doesn't exist, submit route doesn't read `productId` from the body yet.

- [ ] **Step 7: Update `signingApp.ts`**

```ts
import { listProductsForLocation } from './services/productService.js'
import { checkTokenValidity as checkPhotoTokenValidity, submitPhotos } from './services/productPhotoTokenService.js'
import { prisma } from './db/client.js'
// ... existing imports

signingApp.get('/product-photos/:token/products', async (req, res) => {
  const photoToken = await prisma.productPhotoToken.findUnique({ where: { token: req.params.token } })
  if (!photoToken || photoToken.expiresAt.getTime() < Date.now()) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo token not found or expired')
  }
  const search = typeof req.query.search === 'string' ? req.query.search : undefined
  res.json(await listProductsForLocation(photoToken.locationId, { search }))
})

const submitPhotosSchema = z.object({
  productId: z.string().min(1),
  photos: z.array(z.string().min(1)).min(1).max(10),
})

signingApp.post('/product-photos/:token/submit', async (req, res) => {
  const parsed = submitPhotosSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid photo payload')
  }
  await submitPhotos(req.params.token, parsed.data.productId, parsed.data.photos)
  res.json({ status: 'ok' })
})
```

- [ ] **Step 8: Run to verify it passes, then run the full server suite**

Run: `cd server && npm test`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add server/src/services/productService.ts server/src/services/productService.test.ts server/src/signingApp.ts server/src/signingApp.test.ts
git commit -m "feat: add location-scoped product list route and productId-in-body photo submit"
```

---

### Task 5: Server — `/api/products/:id/photo-token` → `/api/products/photo-session`

**Files:**
- Modify: `server/src/routes/products.ts:75-85` (replace the per-product route)
- Modify: `server/src/routes/products.test.ts`

**Interfaces:**
- Consumes: `issueProductPhotoSession` (Task 3).
- Produces: `POST /api/products/photo-session` → `{ token, expiresAt, port, candidates }` (same response shape as before, minus any product-specific data) — this is what Task 7's client hook calls.

- [ ] **Step 1: Write the failing test**

```ts
// replace the existing '/:id/photo-token' test block in products.test.ts with:
describe('POST /api/products/photo-session', () => {
  it('issues a session token scoped to the caller\'s own staff/location', async () => {
    const response = await request(app).post('/api/products/photo-session').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(201)
    expect(response.body.token).toBeTruthy()
    expect(response.body.candidates).toBeDefined()
  })

  it('requires authentication', async () => {
    const response = await request(app).post('/api/products/photo-session')
    expect(response.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npm test -- products`
Expected: FAIL — old route/tests reference `:id/photo-token`, new route doesn't exist.

- [ ] **Step 3: Update the route**

```ts
import { issueProductPhotoSession } from '../services/productPhotoTokenService.js'

productsRouter.post('/photo-session', async (req, res) => {
  if (!req.staff) throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Unauthorized')
  const staff = await prisma.staff.findUniqueOrThrow({ where: { id: req.staff.staffId } })
  const { token, expiresAt } = await issueProductPhotoSession(staff.id, staff.locationId)
  res.status(201).json({
    token,
    expiresAt,
    port: Number(process.env.PORT ?? 3000),
    candidates: reachableSigningCandidates(),
  })
})
```

Remove the old `/:id/photo-token` route entirely.

- [ ] **Step 4: Run to verify it passes, then run the full server suite**

Run: `cd server && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/products.ts server/src/routes/products.test.ts
git commit -m "feat: replace per-product photo-token route with location-level photo-session route"
```

---

### Task 6: Phone page rewrite — two-screen flow, fix multi-photo bug

**Files:**
- Modify: `server/src/productPhotoPage.ts` (full rewrite)

**Interfaces:**
- Consumes: `GET /product-photos/:token/products?search=` and `POST /product-photos/:token/submit` (Task 4).
- Produces: nothing consumed by later tasks — this is the terminal phone-facing UI.

- [ ] **Step 1: Rewrite the page**

Two screens toggled by a simple `currentScreen` variable in the inline script: `'picker'` and `'capture'`.

**Picker screen**: a search input, a list rendered from `GET .../products?search=`, polled every 5s while visible; tapping a product row switches to the capture screen for that product.

**Capture screen**: header shows the selected product's name + a "← Voltar" link back to the picker (without losing captured-but-unsent photos — warn/confirm if any are pending). A prominent "Tirar Foto" button triggers a hidden `<input type="file" accept="image/*" capture="environment">` — **not** `multiple` (mobile camera capture returns one photo per invocation regardless of that attribute; this is the actual root cause of the original one-photo-only bug). Each photo taken is compressed (existing canvas logic, unchanged) and appended to a running `capturedPhotos` array with a thumbnail preview and a per-photo remove button. A secondary, visually smaller "Escolher da Galeria" link uses a separate file input WITHOUT `capture`, supporting real multi-select from the gallery for the (less common) case of adding pre-existing photos. "Enviar" POSTs `{ productId, photos: capturedPhotos }` to `/product-photos/:token/submit`; on success, shows "X fotos adicionadas ao produto." for ~2 seconds, then returns to the picker screen with `capturedPhotos` cleared — not a terminal dead-end, since staff will send photos for the next product in the same session.

```ts
// server/src/productPhotoPage.ts — key structural change, full content in the actual file
function invalidMessage(status: 'expired' | 'not_found'): string {
  if (status === 'expired') return 'Este código expirou. Peça um novo código à loja.'
  return 'Código inválido. Peça um novo código à loja.'
}
// ... STYLES largely unchanged, add styles for .product-list, .product-row, .search-input,
// .capture-primary (large, prominent button), .capture-secondary (small text link)

function photoIntakeBody(token: string): string {
  return `
    <div id="picker-screen">
      <h1>Selecione um produto</h1>
      <input id="search-input" class="file-input" type="text" placeholder="Buscar por nome, categoria ou cor..." />
      <div class="product-list" id="product-list"></div>
    </div>
    <div id="capture-screen" style="display:none">
      <a href="#" id="back-link">← Voltar</a>
      <h1 id="capture-title"></h1>
      <input id="camera-input" type="file" accept="image/*" capture="environment" style="display:none" />
      <button id="take-photo" class="primary capture-primary" type="button">📷 Tirar Foto</button>
      <input id="gallery-input" type="file" accept="image/*" multiple style="display:none" />
      <a href="#" id="gallery-link" class="capture-secondary">Escolher da Galeria</a>
      <div class="previews" id="previews"></div>
      <button id="submit" class="primary" type="button" disabled>Enviar</button>
      <p id="status"></p>
    </div>
    <script>
      var token = ${JSON.stringify(token)};
      var selectedProductId = null;
      var capturedPhotos = [];
      // fetchProducts(search) -> GET token + '/products?search=' + encodeURIComponent(search), render rows,
      // clicking a row sets selectedProductId, shows capture-screen, sets capture-title text
      // takePhotoBtn/galleryLink click -> trigger respective hidden input's .click()
      // both inputs' change handlers -> compress each new file (existing compress() logic, unchanged),
      //   push to capturedPhotos, re-render previews, enable submit when capturedPhotos.length > 0
      // submit click -> POST { productId: selectedProductId, photos: capturedPhotos } to pathname + '/submit'
      //   (pathname here is '/product-photos/' + token, submit path is that + '/submit')
      //   on success: show "N fotos adicionadas ao produto.", clear capturedPhotos, after ~2s switch back to picker-screen
      // backLink click -> if capturedPhotos.length > 0, confirm() before discarding; else just switch back to picker-screen
      // poll fetchProducts on an interval while picker-screen is visible (clear interval when capture-screen shown)
    </script>
  `
}

export function getProductPhotoPageHtml(status: 'valid' | 'expired' | 'not_found', token: string): string {
  const body = status === 'valid' ? photoIntakeBody(token) : `<div class="message"><p>${invalidMessage(status)}</p></div>`
  // ... same outer <!doctype html> wrapper as before
}
```

Note the signature change: `getProductPhotoPageHtml` now takes `token` as a second argument (needed to build the fetch URLs in the inline script) — update the call site in `signingApp.ts`'s `GET /product-photos/:token` route accordingly (`getProductPhotoPageHtml(status, req.params.token)`), and update `checkTokenValidity`'s return type usage there (no more `'used'` branch to handle).

- [ ] **Step 2: Manual verification (no automated test framework for this hand-written HTML/JS file, matching the existing pattern for `signingPage.ts`/the prior `productPhotoPage.ts`)**

Start the server, issue a session token via the real authenticated endpoint, navigate a browser directly to `/product-photos/<token>`, confirm: the picker screen loads and lists products, search filters correctly, tapping a product opens the capture screen, tapping "Tirar Foto" opens the device camera (test in a real mobile browser or Chrome DevTools device emulation with camera permission), taking 2+ photos accumulates them with previews, "Enviar" submits and shows the confirmation, then returns to the picker screen. This will be formally verified end-to-end in Task 8.

- [ ] **Step 3: Commit**

```bash
git add server/src/productPhotoPage.ts server/src/signingApp.ts
git commit -m "feat: rewrite phone page as a two-screen product-picker + camera-capture flow"
```

---

### Task 7: Client — session-level trigger, remove per-product modal, bigger thumbnails

**Files:**
- Modify: `client/src/features/products/ProductsPage.tsx` (add the new session-level trigger button + modal)
- Modify: `client/src/features/products/ProductDrawer.tsx` (remove the per-product remote-photo button/modal; bump `PhotoThumbnail`'s size)
- Modify: `client/src/features/products/AddPhotosRemotelyModal.tsx` → rename/rework into a session-level component (e.g. `AddPhotosSessionModal.tsx`) — no `productId` prop anymore, issues the session token on open, shows the QR, and (unlike the old version) does NOT need a `product` lookup for a "waiting" photo count, since it's not scoped to one product
- Modify: `client/src/features/products/useProducts.ts` (`useIssueProductPhotoToken` → `useIssueProductPhotoSession`, no `productId` argument, calls `POST /api/products/photo-session`)
- Modify: corresponding test files
- Modify: `client/src/locales/pt-BR/products.json` (adjust `photoIntake.*` strings for the session framing, e.g. `modalTitle`/`instructions` no longer reference "this product")

**Interfaces:**
- Consumes: `POST /api/products/photo-session` (Task 5).
- Produces: nothing consumed by later tasks except the e2e test (Task 8), which drives this UI directly.

- [ ] **Step 1: Write the failing tests**

Update `AddPhotosRemotelyModal.test.tsx` (rename to `AddPhotosSessionModal.test.tsx`) to remove any `productId`-specific assertions and confirm it renders/issues a token with no product context. Update `ProductDrawer.test.tsx` to confirm the remote-photo button/modal is gone from the drawer. Add a test in `ProductsPage.test.tsx` for the new trigger button opening the session modal.

- [ ] **Step 2: Run to verify failures, then implement**

- `useProducts.ts`: rename the hook, drop the `productId` param, point at the new endpoint.
- `AddPhotosRemotelyModal.tsx` → `AddPhotosSessionModal.tsx`: drop the `productId` prop and the `useProducts({refetchInterval})`/waiting-count lookup entirely (there's no single product to show a count for anymore) — just issue the token, show the QR/network picker, and a simple "Feche esta janela quando terminar de enviar fotos." message instead of a live count.
- `ProductDrawer.tsx`: delete the `addingPhotosRemotely` state, the `photoIntake.action` button, and the `<AddPhotosRemotelyModal>` render; change `PhotoThumbnail`'s className from `h-8 w-8` to `h-16 w-16` (or similar — pick a size that reads as an actual visible photo, not an icon).
- `ProductsPage.tsx`: add a new button next to "Novo" (`{t('photoIntake.sessionAction')}`) that opens `<AddPhotosSessionModal open={...} onClose={...} />`.

- [ ] **Step 3: Run the full client suite**

Run: `cd client && npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add client/src/features/products/ client/src/locales/pt-BR/products.json
git commit -m "feat: move remote photo intake to a session-level trigger on ProductsPage"
```

---

### Task 8: E2E regression test — the actual point of this redesign

**Files:**
- Modify: `client/e2e/product-photo-intake.spec.ts` (from the just-merged plan — rework its scenario) or create `client/e2e/photo-intake-session.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-7.
- Produces: nothing — terminal verification.

- [ ] **Step 1: Write the test**

Scenario, matching the spec's own stated verification: log in, issue ONE session token via the real authenticated API (`POST /api/products/photo-session`), create Product A via the UI, create Product B via the UI (two separate products, same desktop session), open a second tab navigated directly to the real returned `/product-photos/<token>` URL (not decoding a QR image), on the phone page search for/tap Product A, send a photo, confirm the "fotos adicionadas" message and return-to-picker; without re-issuing or re-navigating to a new token, search for/tap Product B, send a different photo, confirm the same. Switch back to the desktop tab, reload the Products list, open Product A and Product B in turn, and confirm each shows its own uploaded photo as a visible thumbnail (assert on something tied to the actual uploaded data — e.g. the photo count or the specific authenticated path pattern — not just "a modal opened", per the lesson from the prior plan's Task 8 about vacuous assertions).

- [ ] **Step 2: Run it against the real running app**

Seed/create data as needed, start the backend, run:

```bash
cd client && npx playwright test photo-intake-session.spec.ts --reporter=line
```

Expected: passes, proving the core claim of this redesign — one scan serves two (and by extension, many) products in the same session without re-scanning.

- [ ] **Step 3: Commit**

```bash
git add client/e2e/
git commit -m "test: e2e coverage proving one session token serves multiple products without rescanning"
```

## Self-Review

- **Spec coverage**: session-scoped reusable token (Task 1/3), productId-in-submit-body validated against token location (Task 3/4), phone page camera-first + multi-photo via repeated single-shot capture (Task 6), session trigger moved to ProductsPage + bigger thumbnails (Task 7), real JPEG seed fixture (Task 2), e2e proof of no-rescan-needed (Task 8) — all present.
- **Placeholder scan**: none found; the one "check the actual current mapping function" note in Task 4 Step 3 is a real instruction to look at existing code, not an unfilled blank.
- **Type consistency**: `issueProductPhotoSession(staffId, locationId)` → Task 5's route → Task 7's client hook, consistent across all three. `submitPhotos(token, productId, photos)` consistent between Task 3's service and Task 4's route wiring. `checkTokenValidity` return type narrows from 4 states to 3 (`'used'` removed) consistently between Task 3 and Task 6's page-status handling.
- **Cross-task migration risk**: Task 1 explicitly does not require full green tests immediately (Task 3 fixes the tests that reference the old shape) — flagged clearly in Task 1 Step 2 rather than silently left broken.
