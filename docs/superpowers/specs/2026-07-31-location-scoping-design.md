# Location scoping — design

## Context

The schema models `Location` as a first-class multi-tenant boundary (`Staff.locationId`, `Contract.locationId` with `@@unique([locationId, number])`, `ProductPhotoToken.locationId`, per-location `maintenanceBufferDays`/`connectivityMode`), and `Contract` already enforces it correctly end to end. Most other resources don't:

- **Client**: no `locationId` column at all. `listClients`/`getClient`/`updateClient`/`deleteClient` are global.
- **Product**: has the column, but `listProducts`/`getProduct`/`updateProduct`/`deleteProduct` ignore it, and `createProduct` trusts a client-supplied `locationId` from the request body instead of deriving it from the session.
- **Allocation**: no direct `locationId` (reaches it via `productId → Product.locationId`); none of `checkOutAllocation`/`returnAllocation`/`cancelAllocation`/`getProductAvailability`/`isProductAvailableForRange`/`listAllocations` check it.
- **Calendar**: `listGoingOut`/`listDueBack`/`listOverdue` take no location parameter and aggregate across every location.
- **Contract → Client**: `createContract` validates `productId` against `input.locationId` but never validates `clientId` (nothing to validate against, today).
- **Product photos**: `GET /:id/photos/:filename` never checks that `:id` — or its location — matches the requested file; it only validates the filename pattern and reads straight off disk.
- **Staff.login** is globally `@unique`, not scoped per location.

This is currently harmless in practice: `setupService.needsSetup()` guarantees exactly one `Location` row is ever created per install, so every "global" query today happens to return exactly the one store's data. The app is deployed as one Electron install per store today, but the schema is deliberately shaped for a future where multiple stores share one backend/DB, and this gap needs to be closed before that happens — without touching the one live store's data.

## Goals

1. Every resource is scoped to the caller's location, consistently, with the same pattern `Contract` already uses.
2. Add a structural guardrail so a *new* route/model can't reintroduce this bug silently.
3. The schema migration (`Client.locationId`) is safe against the one live production SQLite database with real data — no data loss, no downtime beyond a normal update, a tested and reviewed migration script, not just a Prisma-CLI-generated one taken on faith.

Out of scope: any product decision about cross-location access (e.g. a chain owner who should see multiple stores). Nothing here prevents adding that later; it's a separate feature decision, not a hygiene fix.

## Design

### 1. Schema migration: `Client.locationId`

Add a required `locationId` (FK to `Location`) to `Client`, generated from `models.prisma` via `prisma migrate dev`, targeting SQLite (the live store's provider) first.

Because `needsSetup()` guarantees exactly one `Location` row exists in every current install, the backfill is unambiguous. The migration must, in order:
1. Add the column nullable.
2. `UPDATE "Client" SET "locationId" = (SELECT "id" FROM "Location" LIMIT 1)`.
3. Rebuild the table (SQLite "RedefineTables" pattern) to make the column `NOT NULL` with the FK constraint.

`server/src/db/migrationRunner.ts` (the packaged app's dependency-free replacement for `prisma migrate deploy`) runs each migration script with **no wrapping transaction** — required because SQLite's `PRAGMA foreign_keys=OFF` is a silent no-op inside a transaction, which the table-rebuild step needs. That also means there is no automatic rollback: if the script fails partway, the app refuses to start on next launch until a human resolves it (`migrate resolve` or restoring a backup). Given that, before this migration ships:
- Hand-review the Prisma-CLI-generated SQL rather than trust it blindly.
- Test it against a throwaway copy of a realistically-shaped SQLite file (existing dev/e2e seed data, not an empty DB).
- Prompt the live store's operator to take a manual backup (existing backup/restore feature, PR #10) before installing the release containing this migration — a last line of defense on top of a tested script, not a substitute for testing it.

### 2. Auth middleware: centralize `locationId` resolution

`requireAuth` (`server/src/auth/authMiddleware.ts`) fetches `Staff` once per request and sets `req.staff = { staffId, role, locationId }`. This replaces the `resolveLocationId(staffId)` helper duplicated per-route in `routes/contracts.ts`; every router gets `locationId` without its own DB lookup.

### 3. Guardrail layer

- `server/src/db/scopedClient.ts`: a `scopedDb(locationId)` factory built on Prisma's `$extends`, wrapping the `client` and `product` delegates (the two directly location-owned models) so `findMany`/`findUnique`/`update`/`delete`/`updateMany`/`deleteMany` always merge `{ locationId }` into `where`. Routes for these two models stop importing the bare `prisma` client; the unscoped path isn't reachable from route code.
- `Allocation`/`Calendar` reach location through the `product` relation (a join, not a column), which the extension can't cover — they keep explicit `where: { product: { locationId } }`, matching `contractService.ts`'s existing pattern.
- Shared test setup seeds **two** locations with data in each by default (instead of one), plus one reusable "staff at location A can't see/touch location B's resource" assertion run against every resource type (client, product, allocation, calendar, contract, product photo). This is what turns a future missing filter into a failing test instead of a silent gap invisible in single-location dev/test data — the exact condition that let this go unnoticed in the first place.

### 4. Per-resource changes

- **Client**: `locationId` column (see migration above); `listClients`/`getClient`/`updateClient`/`deleteClient` scoped via `scopedDb`; `createClient` takes `locationId` from `req.staff`, not the request body.
- **Product**: same shape; `createProduct` stops trusting a client-supplied `locationId` — derived from `req.staff.locationId`.
- **Allocation**: `checkOutAllocation`/`returnAllocation`/`cancelAllocation`/`getProductAvailability`/`isProductAvailableForRange`/`listAllocations` take `locationId`, checked through the `product` relation, 404 on mismatch.
- **Calendar**: `listGoingOut`/`listDueBack`/`listOverdue` take `locationId`, filtered via `product: { locationId }`.
- **Contract → Client**: `createContract` adds `client.locationId !== input.locationId → 404`, mirroring the existing product check.
- **Product photos**: `GET /:id/photos/:filename` loads the product by `:id`, checks it belongs to `req.staff.locationId`, and confirms the requested filename is actually one of that product's own `photos` entries before serving it from disk.
- **Staff.login**: uniqueness moves from `@unique` (global) to `@@unique([locationId, login])`. Included in the same Client migration work, same backfill safety considerations (no data change needed here since existing logins stay valid — this only relaxes a global constraint to a scoped one).

### 5. Mismatch response

A resource that exists but belongs to another location returns `404 Not Found`, identical to "doesn't exist" — matches `contractService.ts` today, and doesn't leak that an ID is valid at another location.

### 6. Rollout sequencing

1. Schema migration alone (Client.locationId + Staff.login uniqueness change), hand-verified and soak-tested against realistic data, merged and released on its own before any behavior changes ride along with it.
2. Guardrail layer (`scopedDb` + two-location test fixtures).
3. Per-resource fixes one at a time — Client → Product → Allocation/Calendar → Contract's client check → product photo endpoint — each landing with its own cross-location isolation tests green before the next starts.
4. Ship as one release; prompt for a manual backup before the update installs, on top of the tested migration.

## Testing

- Cross-location isolation test per resource (list/get/update/delete/create, plus the photo endpoint) using the two-location fixture: staff at location A gets 404 (or an empty list) for location B's data.
- Migration test: apply the generated SQL against a copy of seeded (non-trivial) SQLite data and assert every pre-existing `Client` row ends up with the correct (sole) `locationId`, and that the resulting schema matches `models.prisma`.
- Regression coverage for `createProduct` (server-derived `locationId`, request-body value ignored/rejected) and `createContract` (client/location mismatch now 404s).
