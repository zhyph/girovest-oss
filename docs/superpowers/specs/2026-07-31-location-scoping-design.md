# Location scoping — design

## Context

The schema models `Location` as a first-class multi-tenant boundary (`Staff.locationId`, `Contract.locationId` with `@@unique([locationId, number])`, `ProductPhotoToken.locationId`, per-location `maintenanceBufferDays`/`connectivityMode`), and `Contract` already enforces it correctly end to end. Most other resources don't:

- **Client**: no `locationId` column at all. `listClients`/`getClient`/`updateClient`/`deleteClient` are global.
- **Product**: has the column, but `listProducts`/`getProduct`/`updateProduct`/`deleteProduct` ignore it, and `createProduct` trusts a client-supplied `locationId` from the request body instead of deriving it from the session.
- **Allocation**: no direct `locationId` (reaches it via `productId → Product.locationId`); none of `checkOutAllocation`/`returnAllocation`/`cancelAllocation`/`getProductAvailability`/`isProductAvailableForRange`/`listAllocations` check it. Both `getProductAvailability`/`isProductAvailableForRange` and `productService`'s `availabilityFor`/`availabilityByProductId` bottom out in `server/src/services/occupancyQuery.ts` (`maintenanceBufferForProduct`, `loadBlockingWindows`), which trusts whatever `productId` it's handed with no location check of its own.
- **Calendar**: `listGoingOut`/`listDueBack`/`listOverdue` take no location parameter and aggregate across every location.
- **Contract → Client**: `createContract` validates `productId` against `input.locationId` but never validates `clientId` (nothing to validate against, today).
- **Product photos**: `GET /:id/photos/:filename` never checks that `:id` — or its location — matches the requested file; it only validates the filename pattern and reads straight off disk.
- **Relay resume**: `network/relayResume.ts`'s `relayCredentialsFromEnv()` calls `prisma.location.findFirst()` with the comment "single-location per install, matching resolveLocationId's existing assumption elsewhere" — the same class of gap, already present in production code, not just latent.

This is currently harmless in practice: `setupService.needsSetup()` guarantees exactly one `Location` row is ever created per install, so every "global" query today happens to return exactly the one store's data. The app is deployed as one Electron install per store today, but the schema is deliberately shaped for a future where multiple stores share one backend/DB, and this gap needs to be closed before that happens — without touching the one live store's data.

**Revision note:** this design went through an adversarial review pass before implementation (see repo history for the first version). That review found the original migration plan — as described — could destroy the one live store's data on a failed-then-retried upgrade, and identified several other gaps. This version incorporates every fix; see "Resolved from review" callouts inline.

## Goals

1. Every resource is scoped to the caller's location, consistently, with the same pattern `Contract` already uses.
2. Add a structural guardrail so a *new* route/model can't reintroduce this bug silently.
3. The schema migration (`Client.locationId`) is safe against the one live production SQLite database with real data: no data loss, no downtime beyond a normal update, and — critically — a **safe failure mode**. This design does not claim the migration cannot fail; it claims that if it does fail, nothing is lost and there is a real, working recovery path on the machine.

Out of scope: any product decision about cross-location access. The product direction is one login per location (no role-based, multi-account, or cross-location access model planned) — `Staff.role` already exists in the schema/JWT but currently gates nothing, and this design doesn't add any behavior that depends on it. If a cross-location or multi-account model is ever wanted later, that's a separate feature decision; nothing here forecloses it, but nothing here should be read as anticipating it either.

How this fits a future hosted/web deployment (as opposed to one Electron install per store) is still an open question, deliberately not answered here — every fix in this design (scoping by `Location`, the `scopedDb` guardrail, the Postgres schema already tracking the SQLite one) is deployment-shape-agnostic on purpose, so it doesn't block that direction, but the specifics (how a login maps to a location on the web, single shared login page vs. one per store, etc.) belong to that design when it's actually being built.

## Design

### 1. Migration safety prerequisites (do these *before* authoring the `Client` migration)

The review found the app's existing safety nets don't actually hold up against a failure in a migration this size. These are prerequisites, not nice-to-haves — the `Client` migration should not be authored until they land, because it's the first migration whose failure mode they're inadequate for.

**1a. The pre-migration backup destroys itself on retry — fix first.**

`client/electron/backup.ts`'s `backupDatabaseIfNeeded` keys its backup directory by `<oldVersion>` and calls `fs.rmSync(destDir, { recursive: true, force: true })` before recopying, on the documented assumption ("Keyed by `<oldVersion>` alone and overwritten on retry: a failed migration is transactional (DB untouched)...") that a failed migration never touches `dev.db`. That assumption is false: `server/src/db/migrationRunner.ts` runs each migration script with **no wrapping transaction** (required — SQLite's `PRAGMA foreign_keys=OFF`, needed for the table-rebuild pattern below, is a silent no-op inside a transaction), and `better-sqlite3`'s `db.exec()` commits statements as it goes. Concretely: `backupDatabaseIfNeeded` copies `dev.db` → `backups/<oldVersion>/`; `runMigrations` fails partway through the `Client` rebuild (say, after `DROP TABLE "Client"`, before `RENAME`); the marker never advances; on relaunch, `backupDatabaseIfNeeded` computes the *same* `destDir`, deletes the one good backup, and overwrites it with the now-corrupted `dev.db`.

Fix: `backupDatabaseIfNeeded` must not delete an existing `destDir` and replace it with a new copy when retrying after a failure — e.g. skip the backup entirely if `destDir` already exists and is non-empty (the first copy, taken before the DB was touched, is the one worth keeping), rather than always re-copying current (possibly now-corrupt) state over it.

**1b. The documented recovery path doesn't exist on the live machine — fix the guidance, and bridge it to something the operator can actually use.**

`migrationRunner.ts`'s failure message and this design's earlier draft both pointed at `prisma migrate resolve`. The packaged app does not ship the Prisma CLI (`client/electron-builder.yml`'s `extraResources` is an explicit allowlist of native modules and `.sql` files only) — that command does not exist on the store's machine. There are also **two separate, incompatible backup mechanisms** in this app today:
- The automatic pre-migration backup (1a, above): a raw `dev.db` + sidecar file copy under `userData/backups/<version>/`.
- The manual backup/restore feature (PR #10): `backup:restore` (IPC, `client/electron/main.ts`) restores from a `.zip` matching `girovest-backup-<timestamp>.zip`, produced by the user-triggered export flow (`manualBackupActions.ts`). It cannot currently open the raw pre-migration backup folder.

A failed migration today has no in-app recovery path at all — only a manual filesystem copy an ordinary shop operator can't be expected to perform. Fix: make the pre-migration backup restorable through the *existing* restore UI, e.g. have `backupDatabaseIfNeeded` write (or additionally produce) a `girovest-backup-<timestamp>.zip` in the same format `runManualBackup` produces, so a failed-migration operator can use the same "pick a backup file, restore" flow that already exists rather than a new one-off mechanism.

**1c. Migrations run before the previous process is confirmed gone — reduces the odds of hitting 1a/1b at all.**

`client/electron/main.ts`'s `startServer` calls `backupDatabaseIfNeeded` then `runMigrations` (line ~328-333) before `waitForPortFree` (line ~347) — and `waitForPortFree` is a *network port* probe for the *new* server's own bind, not a wait for the *old* process to release its file handle on `dev.db`. The file already has a comment acknowledging this exact race for the restore path (`waitForProcessExit`'s comment: "unlike waitForPortFree's existing use for the *next* server's startup, there was previously nothing making the *current* restore wait for the *old* server to actually be gone first") — the same gap exists for migrations, and migrations are the largest write this app has ever done to `dev.db`. On an `electron-updater` restart, the new instance can reach `runMigrations` while the old process still holds the file, risking `SQLITE_BUSY` mid-rebuild — precisely the failure mode 1a/1b need to survive. Fix: wait for the previous process to actually be gone (or retry-with-backoff on a locked file, mirroring `waitForPortFree`'s probe loop) before `runMigrations` starts. Exact mechanism is an implementation detail; the requirement is no migration starts while the old process might still hold the file.

### 2. Schema migration: `Client.locationId`

Add a required `locationId` (FK to `Location`) to `Client`, targeting SQLite (the live store's provider) first, generating the equivalent Postgres migration (`npm run db:migrate:postgresql`) alongside it so the two provider schemas — generated from the same `models.prisma` — don't silently diverge, even with no live Postgres deployment today.

**Resolved from review:** `prisma migrate dev` does not generate the migration this design needs. Its auto-generated rebuild for a new required column omits that column from the `INSERT INTO "new_Client" (...) SELECT ...` clause, which fails with a `NOT NULL` constraint violation against any non-empty table. This script must be **hand-authored**, using the CLI output only as a starting skeleton, and reviewed against this design, not trusted as generated.

The migration must, in order:
1. Add the column nullable.
2. **Assert the invariant this whole plan depends on, rather than trust it.** Before backfilling, the script must hard-fail (not silently proceed) unless exactly one `Location` row exists — e.g. a guard statement that forces a runtime error when `(SELECT COUNT(*) FROM "Location") <> 1`. Without this, a violated invariant (see "Invariant enforcement," below) would silently assign every `Client` to an arbitrary location with zero signal. With 1a/1b/1c fixed, an aborted migration here is a *safe* failure — recoverable, not silently wrong data.
3. `UPDATE "Client" SET "locationId" = (SELECT "id" FROM "Location" LIMIT 1)`.
4. Rebuild the table (SQLite "RedefineTables" pattern: create new table with the column `NOT NULL` + FK, copy, drop old, rename) with `PRAGMA foreign_keys=OFF` around it.

This exact rebuild-with-dependent-FKs shape is already proven safe by this runner: `prisma/sqlite/migrations/20260727171057_add_location_maintenance_buffer` rebuilds `Location` itself, which is referenced by five other tables (two with `ON DELETE CASCADE`), and has already shipped successfully. That's the precedent to build from, not a first attempt at this pattern.

Before this migration ships:
- Hand-verify the script (not just trust CLI output — see above).
- Test it against a throwaway copy of realistically-shaped SQLite data (existing dev/e2e seed data, not an empty DB), including a deliberate multi-location test to confirm the invariant guard actually aborts cleanly.
- Prompt the live store's operator to take a manual backup before installing the release containing this migration — on top of the tested script and the now-restorable automatic backup (1b), not a substitute for either.

**Rollout note:** this migration and the `Client`-service code that depends on the column being present (`clientService.createClient`, etc.) must ship in the **same release**. A `Client.locationId` column that's `NOT NULL` breaks `createClient` immediately if the code isn't updated in lockstep — there's no safe way to ship the schema change alone first.

**Dropped from scope (resolved from review):** the earlier draft proposed also moving `Staff.login` from `@unique` to `@@unique([locationId, login])`. Dropped: it breaks `authRoutes.ts`'s `prisma.staff.findUnique({ where: { login } })` (login stops being a valid unique-where target), and the login form only ever sends `login` + `password` with no location to disambiguate by if two locations shared a login — an unresolvable ambiguity under the current one-login-per-location, no-cross-location-model product direction. It buys nothing today and the "how do logins map to locations" question is explicitly deferred to the future hosted-deployment design anyway (see Goals). Not included.

**Invariant enforcement (non-blocking, worth doing in the same pass):** the one-Location invariant holds in every packaged build today (`server/scripts/db-tools.ts` and seed scripts are dev-only — not bundled by `electron-builder.yml`, not imported from `src/`) but is enforced only by convention: `setupService.needsSetup()`/`completeSetup()` is a check-then-create with no transaction, and `POST /api/setup` (`routes/setup.ts`) has no auth middleware, so a double-submitted setup wizard could race two `Location` creations. The migration's invariant guard (step 2, above) turns a violation into a safe abort rather than silent corruption; consider also hardening `setupService` itself (a transaction, or a partial unique constraint) as a follow-up, since a broken invariant would still block the app from ever completing this migration until fixed.

### 3. Auth middleware: centralize `locationId` resolution

`requireAuth` (`server/src/auth/authMiddleware.ts`) fetches `Staff` once per request and sets `req.staff = { staffId, role, locationId }`. This replaces the `resolveLocationId(staffId)` helper duplicated per-route in `routes/contracts.ts`; every router gets `locationId` without its own DB lookup.

### 4. Guardrail layer

**Resolved from review:** the original design claimed a `scopedDb(locationId)` Prisma `$extends` wrapper would make "the unscoped path... not reachable from route code." That's not achievable, and the design should not claim it is:
- Query extensions intercept only **top-level delegate calls**. Nested reads/writes (`contractService.getContract`'s `include: { client: {...} }`, `clientService.createClient`'s nested `identityDocuments`/`addressLines` creates) don't go through the extension at all and need manual review, not automated coverage.
- `productService.ts`/`clientService.ts` also call `prisma.allocation.*` directly for history/join checks — they can't stop importing the bare `prisma` client, so "routes stop importing bare `prisma`" doesn't hold at the service layer either. Import discipline alone isn't the guardrail; treat it as one layer, backed by a lint rule (an `ast-grep` pattern flagging a bare `prisma.client`/`prisma.product` call outside `scopedClient.ts` itself) as defense in depth.
- The original operation list (`findMany`/`findUnique`/`update`/`delete`/`updateMany`/`deleteMany`) omits operations this codebase actually uses against these models: `findFirstOrThrow`, `findUniqueOrThrow` (e.g. `products.ts`, `contracts.ts`, `allocationService.ts` all use `OrThrow` variants), `count`, `upsert`, `create`, `createMany`. An allow-list of only some operations means a new call using an unlisted one silently passes through unscoped — the opposite of the intended guardrail.

Revised design: `server/src/db/scopedClient.ts` builds `scopedDb(locationId)` using Prisma's `$allOperations` extension hook with an explicit **deny-by-default** switch — every operation this codebase performs against `client`/`product` (`findMany`, `findFirst`, `findFirstOrThrow`, `findUnique`, `findUniqueOrThrow`, `create`, `update`, `updateMany`, `upsert`, `delete`, `deleteMany`, `count`) gets `locationId` merged into its `where`/`data` as appropriate, and any operation not explicitly handled **throws** rather than passing through. `prisma.$transaction` call sites that need scoping (e.g. `clientService.updateClient`'s transaction) must be given the extended client instance, not the bare one, so writes inside the transaction stay scoped too.

`Allocation`/`Calendar` reach location through the `product` relation (a join, not a column), which the extension can't cover — they keep explicit `where: { product: { locationId } }`, matching `contractService.ts`'s existing pattern. `occupancyQuery.ts`'s helpers (`maintenanceBufferForProduct`, `loadBlockingWindows`) take a bare `productId` with no location check of their own by design — every caller (`allocationService.getProductAvailability`/`isProductAvailableForRange`, `productService.availabilityFor`/`availabilityByProductId`) must only ever pass a `productId` it has already verified belongs to the caller's location.

Shared test setup seeds **two** locations with data in each by default, plus one reusable "staff at location A can't see/touch location B's resource" assertion run against every resource type (client, product, allocation, calendar, contract, product photo). This is what turns a future missing filter into a failing test instead of a silent gap invisible in single-location dev/test data — the exact condition that let this go unnoticed in the first place.

### 5. Per-resource changes

- **Client**: `locationId` column (§2); `listClients`/`getClient`/`updateClient`/`deleteClient` scoped via `scopedDb`; `createClient` takes `locationId` from `req.staff`, not the request body.
- **Product**: same query shape via `scopedDb`. `createProduct` stops trusting a client-supplied `locationId` in `POST /api/products`'s body — **the derivation happens at the route** (`routes/products.ts`), not inside `productService.createProduct` itself: the service keeps taking `locationId` as an explicit parameter, because it already has legitimate non-HTTP callers that pass their own resolved `locationId` — `productPhotoTokenService.ts`, and `listProductsForLocation` from `signingApp.ts`/`network/relayClient.ts` — none of which have a `req.staff` to derive from.
- **Allocation**: `checkOutAllocation`/`returnAllocation`/`cancelAllocation`/`getProductAvailability`/`isProductAvailableForRange`/`listAllocations` take `locationId`, checked through the `product` relation, 404 on mismatch.
- **Calendar**: `listGoingOut`/`listDueBack`/`listOverdue` take `locationId`, filtered via `product: { locationId }`.
- **Contract → Client**: `createContract` adds `client.locationId !== input.locationId → 404`, mirroring the existing product check. (Ordering is fine: this depends only on the `Client.locationId` column existing, which §2 already guarantees before this lands.)
- **Product photos**: `GET /:id/photos/:filename` loads the product by `:id`, checks it belongs to `req.staff.locationId`, and confirms the requested filename is actually one of that product's own `photos` entries before serving it from disk.
- **Relay resume**: `relayCredentialsFromEnv()` gains a `locationId` parameter for its request-context callers (`routes/products.ts`, `routes/contracts.ts`), which pass `req.staff.locationId` instead of letting it internally call `prisma.location.findFirst()`. Its boot-time caller (`server.ts`, no request/session to derive a location from) keeps resolving "the sole location for this install" itself — correct only under the current one-location-per-install model, and should be commented as such so it isn't mistaken for already being location-safe if this server process ever serves more than one location.

**Reviewed, intentionally unchanged:**
- `contractBackfill.ts` runs once at every boot and repairs orphaned allocations across the *entire* database as a maintenance sweep, not a per-request read — it's correctly location-agnostic by design, not a missed gap. Called out explicitly so it isn't re-flagged later.
- `backupService.ts`'s `POST /api/backup/snapshot` dumps the whole database file (already refuses on Postgres). Fine for a single-location install; a real cross-tenant risk in a future hosted deployment. Left as-is here — same reasoning as the rest of "hosted deployment" being out of scope — but flagged so it isn't forgotten when that design happens.

### 6. Mismatch response

A resource that exists but belongs to another location returns `404 Not Found`, identical to "doesn't exist" — matches `contractService.ts` today, and doesn't leak that an ID is valid at another location.

### 7. Rollout sequencing

1. Migration safety prerequisites (§1a/1b/1c) — backup-on-retry fix, bridging the automatic backup into the existing restore UI, and the file-lock/process-exit ordering fix. These are infrastructure this migration leans on; they land first, independent of everything else here.
2. Schema migration (§2) — `Client.locationId` (and its Postgres counterpart) — **together with** the `Client`-service code changes that depend on the column, hand-verified and soak-tested against realistic data, including a deliberate multi-location invariant-guard test.
3. Guardrail layer (§4: `scopedDb` deny-by-default + two-location test fixtures + the `ast-grep` bare-`prisma` lint check).
4. Per-resource fixes one at a time — Product → Allocation/Calendar → Contract's client check → product photo endpoint → relay resume — each landing with its own cross-location isolation tests green before the next starts. (Client's route/service changes already landed as part of step 2.)
5. Ship as one release; prompt for a manual backup before the update installs, on top of the tested migration and the now-restorable automatic backup.

## Testing

- Cross-location isolation test per resource (list/get/update/delete/create, plus the photo endpoint) using the two-location fixture: staff at location A gets 404 (or an empty list) for location B's data.
- Migration test: apply the hand-authored SQL against a copy of seeded (non-trivial) SQLite data and assert every pre-existing `Client` row ends up with the correct (sole) `locationId`, and that the resulting schema matches `models.prisma`.
- Migration invariant-guard test: seed **two** `Location` rows before applying the migration and assert it aborts cleanly (no partial schema change, clear error) rather than mis-assigning data.
- Backup-safety regression test: simulate a migration failure partway through, relaunch (re-invoke `backupDatabaseIfNeeded`), and assert the original pre-migration backup still exists and is intact — not overwritten by the failed attempt.
- Regression coverage for `createProduct` (server-derived `locationId` at the route, request-body value ignored/rejected) and `createContract` (client/location mismatch now 404s).
- `scopedDb` unit tests: confirm every operation this codebase uses against `client`/`product` is explicitly handled, and that calling an unhandled operation throws rather than silently executing unscoped.
