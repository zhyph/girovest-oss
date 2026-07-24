# Product Photo Intake + Faster Registration

Date: 2026-07-24
Status: Approved

## Goal

The client has ~1500 dresses to register and needs this to be fast. Two
distinct problems, addressed together because they compose naturally:

1. **Getting a photo onto a product is currently painful.** `ProductDrawer`
   only accepts a pasted URL — there's no way to get a phone photo into the
   app without some manual file-transfer step (email, cloud upload, USB).
   The client explicitly asked for a QR-code-or-endpoint way to send a
   picture "quickly ... without requiring too much work."
2. **Repetitive form entry for similar dresses is slower than it needs to
   be.** Registering many similar dresses back-to-back currently means
   re-typing category/size/color/price/deposit each time and re-opening the
   drawer for every new product.

CSV bulk import was considered and explicitly deferred — it's a
substantially larger feature (file format, column validation, error
reporting, category/dedup handling) that changes the entry model entirely
and deserves its own design later, once the client has seen how much
friction remains after this ships.

## Decisions

- **Reuse the existing remote-signing pattern directly**, rather than
  designing something new. This app already has a proven QR-based phone
  workflow for contract signing (`SigningToken` model, a second minimal
  unauthenticated `signingApp` bound to a real LAN address, a hand-written
  vanilla-JS phone page with no build step, desktop-side polling). Photo
  intake follows the identical shape:
  - New **`ProductPhotoToken`** Prisma model — same fields as
    `SigningToken` (`token`, `productId`, `expiresAt`, single-use `usedAt`,
    cascade-deletes with the product). A dedicated model, not a
    generalization of `SigningToken` across entity types — that would need
    nullable FKs to two different tables and touches an already-shipped,
    proven flow for no real benefit; one purpose-built token model per flow
    matches this codebase's existing convention.
  - New `productPhotoTokenService.ts` mirroring `signingService.ts`:
    `issueProductPhotoToken` (verifies the product belongs to the caller's
    location, clears any existing unclaimed token for that product, issues
    a fresh 15-min-TTL token), `checkTokenValidity`, `submitPhotos` (atomic
    single-use claim via `updateMany({where:{token,usedAt:null,expiresAt:{gt:now}}})`,
    identical to the signing flow's race-safe pattern).
  - **Extend the existing `signingApp`** with two new routes
    (`GET /product-photos/:token`, `POST /product-photos/:token/submit`)
    rather than standing up a third Express app — same LAN-binding safety
    model, same "never `0.0.0.0`" guarantee already established.
  - New authenticated `POST /api/products/:id/photo-token` (mirrors
    `POST /api/contracts/:id/sign-token`), returning the token + LAN
    candidates + port.
  - New client `AddPhotosRemotelyModal.tsx` mirroring `SignRemotelyModal.tsx`
    exactly: issues the token on open, builds the LAN URL, shows a QR code
    (`qrcode` package, already a dependency), a network picker if multiple
    LAN candidates exist, and polls the product until new photos appear.
- **Photos are stored as real files on disk**, not base64 data URLs in the
  database (the signature feature's approach, which works fine for one
  small one-time image per contract but doesn't scale to several photos ×
  1500 products). A new `PRODUCT_PHOTOS_DIR` env var follows the exact
  resolution pattern `main.ts` already uses for `DATABASE_URL`/`JWT_SECRET`:
  `./product-photos` (relative to server cwd) in dev, resolved to
  `path.join(userDataPath, 'product-photos')` in the packaged Electron app.
  `Product.photos` stores relative paths served back through a new route
  (`GET /api/products/:id/photos/:filename` or equivalent static serving)
  instead of pasted URLs or data URLs.
- **Client-side photo compression, no new dependency.** The phone page
  (vanilla JS, no framework/build step, matching `signingPage.ts`'s existing
  style) draws each picked photo onto an offscreen `<canvas>`, downscales it
  to a maximum dimension (e.g. 1600px on the long edge), and re-encodes as
  JPEG at reduced quality (`canvas.toDataURL('image/jpeg', 0.7)` or similar)
  before building the request. This is necessary because raw phone camera
  photos (2–8MB) would blow far past any sane request-size limit; a
  compressed photo is typically 50–200KB.
- **Multiple photos submit together in one request**, consuming the token
  once — the phone page lets staff pick/take several photos before hitting
  "Enviar," rather than requiring a fresh QR scan per photo.
- **The photo-append write is atomic** on the server side (the token's
  single-use claim already prevents concurrent submissions to the same
  token/product, so a straightforward Prisma update is sufficient — no
  separate locking needed beyond what the token claim already provides).
- **"Save and add another" and "duplicate from last" unify into one
  mechanism.** After any successful product create, the client remembers
  that product's category/size/color/rentalPrice/depositAmount/description
  in ephemeral, in-memory state (not persisted across app restarts — this
  is session-scoped convenience, not data). The next time a new-product
  form opens (whether via a new "Salvar e adicionar outro" option that keeps
  the drawer open after save, or via a fresh "Novo" click later in the same
  session), it prefills from that remembered state — leaving `name` and
  `photos` always blank, since those are the fields expected to differ per
  product.
- **The remote-photo button only appears once a product already exists**
  (has an id) — mirroring the existing precedent that a contract must be
  created before it can be signed remotely. A product must be saved at
  least once before its QR code becomes available.
- **Out of scope, deliberately:**
  - CSV bulk import (separate future design).
  - General backup/durability of the photos directory. The existing
    `backup.ts` only protects `dev.db*` around app-version migrations and
    doesn't address general corruption of `dev.db` itself either — treating
    photo files the same way (protected the same as the DB is, no more, no
    less) isn't a new gap this feature introduces.

## Testing

- Server: `productPhotoTokenService` unit tests mirroring
  `signingService.test.ts` (issuance, single-use claim, expiry, wrong-location
  rejection). `signingApp`'s two new routes tested mirroring
  `signingApp.test.ts` (valid/expired/used/not-found token states, request
  size/format validation). A photo-append test confirming photos actually
  land in the product's `photos` array and on disk.
- Client: `ProductDrawer` tests for the save-and-add-another flow and the
  duplicate-from-last prefill (including that `name`/`photos` are never
  prefilled). `AddPhotosRemotelyModal` tests mirroring
  `SignRemotelyModal.test.tsx` (QR generation, network picker, polling).
- Manual verification: a second browser tab/session navigated directly to
  the real LAN URL (not decoding the actual QR image), simulating the
  phone, submitting photos, and confirming the desktop's product photo list
  updates via polling — the same verification approach already used and
  documented for remote contract signing.
