# Location Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every resource in dress-store-app (Client, Product, Allocation, Calendar, Contract, product photos, relay sessions) respect `locationId`, closing gaps that are dormant today (only one `Location` row has ever existed in production) but would leak data across stores the moment a second location shares a database — while never risking the one live store's real data during the `Client.locationId` schema migration.

**Architecture:** A `scopedDb(locationId)` Prisma Client Extension becomes the only sanctioned way to query/write `Client`/`Product`; every route derives `locationId` from the authenticated staff member (`req.staff.locationId`, resolved once by `requireAuth`) and passes it through service functions down to `scopedDb`. Models reached only via a relation (`Allocation`, `Calendar`) are scoped with explicit `where: { product: { locationId } }` joins instead, since a Prisma extension can't intercept those. The `Client.locationId` migration itself gets its own hardened safety net (atomic backups, a documented recovery path, an invariant guard) because it is the first schema change this app has ever shipped that touches the one live store's real data with a non-trivial backfill.

**Tech Stack:** TypeScript, Express 5, Prisma 7 (`@prisma/client`, `prisma`), `better-sqlite3` (packaged Electron app) / `pg` (Postgres, dev/future-hosted parity only), Vitest, `ast-grep`.

**Reference:** `docs/superpowers/specs/2026-07-31-location-scoping-design.md` — read it before starting; every task below cites the design section it implements.

## Global Constraints

- Target the live store's provider (SQLite) first in every migration/runtime task; generate the Postgres counterpart alongside it (`npm run db:migrate:postgresql`) but SQLite is what ships.
- A resource that exists but belongs to another location returns `404 Not Found` everywhere — never `403`, never a distinguishable error (design §6).
- No product decision about cross-location access (roles, multi-account, shared logins) is in scope. One login per location stays true; don't add anything that assumes otherwise (design Goals).
- `Client.locationId` and the `Client`-service code that depends on it (creation, updates) must ship in the same release — never a state where the column exists but the code doesn't handle it, or vice versa. This plan sequences the guardrail layer (Task 7) before full `Client` route/service scoping (Task 12) purely for build-order reasons (`scopedDb` has to exist before code can call it) — both still land in the same release before anything ships.
- Every SQL migration file is hand-authored/hand-verified, never trusted as raw `prisma migrate dev` output — Prisma's auto-generated rebuild for a new required column omits that column from its `INSERT ... SELECT`, which fails on any non-empty table.
- Follow the two-location test pattern (Task 11) for every resource task from Task 12 onward — a single-location fixture cannot catch a missing filter, which is exactly how every gap in this plan went unnoticed originally.
- Every route in this plan uses `req.staff!.locationId` (non-null assertion), not the explicit `if (!req.staff) throw ...` guard some existing routes use today. That guard predates `requireAuth` guaranteeing `req.staff` is set on every request that reaches a handler behind `router.use(requireAuth)` — once every router doing location-aware work is behind that middleware (true after Task 9), the assertion is accurate and the explicit runtime check would be dead code. Don't add the old guard pattern to new code; it's fine that older, untouched routes still have it.

---

## Task 1: Fix the pre-migration backup so a retry can't destroy it

**Design ref:** §1a

**Files:**
- Modify: `client/electron/backup.ts`
- Test: `client/electron/backup.test.ts` (create if it doesn't exist; check first)

**Interfaces:**
- Produces: `backupDatabaseIfNeeded(userDataPath: string, currentVersion: string, today: string): string | null` — same signature as today, but now returns the correct existing `destDir` on a "already backed up" skip instead of `null`, and never overwrites a complete prior backup with a possibly-torn retry.

- [ ] **Step 1: Check for an existing test file and read current behavior**

```bash
ls client/electron/backup.test.ts 2>/dev/null && cat client/electron/backup.test.ts
cat client/electron/backup.ts
```

- [ ] **Step 2: Write failing tests for the new completion-signal behavior**

Add to `client/electron/backup.test.ts` (create the file with this header if it doesn't exist — match the existing suite's style if it does):

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { backupDatabaseIfNeeded, readBackupMarker, pruneBackups } from './backup.ts'

let userDataPath: string

beforeEach(() => {
  userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'))
})

afterEach(() => {
  fs.rmSync(userDataPath, { recursive: true, force: true })
})

function writeDb(content = 'db-bytes') {
  fs.writeFileSync(path.join(userDataPath, 'dev.db'), content)
}

describe('backupDatabaseIfNeeded completion safety', () => {
  it('a completed backup is provably complete on disk', () => {
    writeDb('original')
    const destDir = backupDatabaseIfNeeded(userDataPath, '0.11.0', '2026-08-01')
    expect(destDir).toBeTruthy()
    expect(fs.readFileSync(path.join(destDir!, 'dev.db'), 'utf-8')).toBe('original')
  })

  it('a retry after the DB was corrupted mid-migration does not overwrite the good backup', () => {
    writeDb('original')
    const destDir = backupDatabaseIfNeeded(userDataPath, '0.11.0', '2026-08-01')!
    // Simulate the migration corrupting dev.db without ever advancing the marker
    // (writeBackupMarker only runs after migrations succeed — see main.ts).
    writeDb('corrupted-mid-migration')
    const retryDestDir = backupDatabaseIfNeeded(userDataPath, '0.11.0', '2026-08-01')
    expect(retryDestDir).toBe(destDir)
    expect(fs.readFileSync(path.join(destDir, 'dev.db'), 'utf-8')).toBe('original')
  })

  it('a truncated backup (copy itself failed partway) is redone on retry, not trusted as complete', () => {
    writeDb('original')
    // Simulate a partial prior attempt: a destDir that exists but was never
    // completed (no completion signal) — e.g. from a crash mid-copy.
    const backupsDir = path.join(userDataPath, 'backups')
    fs.mkdirSync(path.join(backupsDir, '0.11.0'), { recursive: true })
    // Deliberately no sentinel/no atomic-rename marker written here.

    const destDir = backupDatabaseIfNeeded(userDataPath, '0.11.0', '2026-08-01')!
    expect(fs.readFileSync(path.join(destDir, 'dev.db'), 'utf-8')).toBe('original')
  })

  it('the staging directory is never visible to pruneBackups', () => {
    for (let i = 0; i < 7; i++) {
      writeDb(`v${i}`)
      backupDatabaseIfNeeded(userDataPath, `0.${i}.0`, `2026-08-0${(i % 9) + 1}`)
    }
    const backupsDir = path.join(userDataPath, 'backups')
    const entries = fs.readdirSync(backupsDir)
    expect(entries.every((name) => !name.startsWith('.staging'))).toBe(true)
    // 5-slot retention still holds against only real, complete backups.
    expect(entries).toHaveLength(5)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- backup.test.ts` (from `client/`)
Expected: FAIL — current implementation deletes and recopies unconditionally, so the "retry doesn't overwrite" test fails.

- [ ] **Step 4: Rewrite `backupDatabaseIfNeeded` with atomic completion**

Replace the implementation in `client/electron/backup.ts`:

```typescript
import fs from 'fs'
import path from 'path'

export const MAX_BACKUPS = 5

const MARKER_FILENAME = 'db-backup-version'
const COMPLETE_SENTINEL = '.complete'

export function readBackupMarker(userDataPath: string): string | null {
  const markerPath = path.join(userDataPath, MARKER_FILENAME)
  return fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf-8') : null
}

export function writeBackupMarker(userDataPath: string, version: string): void {
  fs.writeFileSync(path.join(userDataPath, MARKER_FILENAME), version, 'utf-8')
}

function isComplete(destDir: string): boolean {
  return fs.existsSync(path.join(destDir, COMPLETE_SENTINEL))
}

// Copies dev.db plus any sidecars (-journal/-wal/-shm) into
// userData/backups/<oldVersion>/ before a new app version's migrations run.
// Returns the backup dir (existing or newly written), or null when there was
// nothing to back up (true fresh install).
//
// Completion, not existence, is what a retry checks: a directory without the
// completion sentinel might be an old, pre-this-fix backup (no sentinel was
// ever written for it) or a prior attempt that crashed mid-copy — in both
// cases it is NOT provably safe to treat as done, and it is NOT safe to
// delete (it might hold the one good pre-migration copy). It's moved aside
// instead, and a fresh, complete backup is written in its place.
export function backupDatabaseIfNeeded(
  userDataPath: string,
  currentVersion: string,
  today: string,
): string | null {
  const marker = readBackupMarker(userDataPath)
  if (marker === currentVersion) return null

  const dbFiles = fs
    .readdirSync(userDataPath)
    .filter((name) => name === 'dev.db' || name.startsWith('dev.db-'))
  if (dbFiles.length === 0) return null

  const dirName = marker ?? `pre-updater-${today}`
  const backupsDir = path.join(userDataPath, 'backups')
  const destDir = path.join(backupsDir, dirName)

  if (fs.existsSync(destDir)) {
    if (isComplete(destDir)) return destDir
    // Not provably complete: preserve it (it may be the only good copy) and
    // let normal retention clean it up later rather than deleting or
    // overwriting it.
    fs.renameSync(destDir, `${destDir}.unverified-${Date.now()}`)
  }

  fs.mkdirSync(backupsDir, { recursive: true })
  // Staged OUTSIDE backups/ so pruneBackups (which enumerates every
  // directory directly under backups/) never sees a directory mid-copy and
  // can't evict it, or count it against the 5-slot retention.
  const stagingDir = fs.mkdtempSync(path.join(userDataPath, '.backup-staging-'))
  try {
    for (const name of dbFiles) {
      fs.copyFileSync(path.join(userDataPath, name), path.join(stagingDir, name))
    }
    fs.writeFileSync(path.join(stagingDir, COMPLETE_SENTINEL), '')
    fs.renameSync(stagingDir, destDir)
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true })
    throw error
  }

  pruneBackups(backupsDir)
  return destDir
}

export function pruneBackups(backupsDir: string, max: number = MAX_BACKUPS): void {
  if (!fs.existsSync(backupsDir)) return
  const dirs = fs
    .readdirSync(backupsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      mtimeMs: fs.statSync(path.join(backupsDir, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const dir of dirs.slice(max)) {
    fs.rmSync(path.join(backupsDir, dir.name), { recursive: true, force: true })
  }
}
```

Note the removed false comment ("a failed migration is transactional... overwritten on retry") — deleted, not edited, since the whole premise is now handled differently.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- backup.test.ts`
Expected: PASS — all four tests green.

- [ ] **Step 6: Commit**

```bash
git add client/electron/backup.ts client/electron/backup.test.ts
git commit -m "Make pre-migration backup atomic so a retry can't destroy it"
```

---

## Task 2: Wait for the previous process to release the DB file before backing up or migrating

**Design ref:** §1c

**Files:**
- Modify: `client/electron/main.ts`
- Test: `client/electron/main.test.ts` (check for existing tests around `startServer`/`waitForPortFree` first)

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `waitForFileWritable(filePath: string, timeoutMs?: number, intervalMs?: number): Promise<boolean>` — a new exported helper, probe-loop style like `waitForPortFree`, called before `backupDatabaseIfNeeded` in `startServer`.

- [ ] **Step 1: Read the current `startServer`/`waitForPortFree` code and any existing tests**

```bash
grep -n "waitForPortFree\|waitForProcessExit\|startServer\b" client/electron/main.ts
ls client/electron/main.test.ts 2>/dev/null && grep -n "waitForPortFree\|startServer" client/electron/main.test.ts
```

- [ ] **Step 2: Write a failing test for the new probe helper**

Add to `client/electron/main.test.ts` (matching whatever import style the existing tests there use for `main.ts` exports — check the file first; if `waitForPortFree` is already tested there, follow that pattern exactly):

```typescript
import fs from 'fs'
import os from 'os'
import path from 'path'
import { waitForFileWritable } from './main.ts'

describe('waitForFileWritable', () => {
  it('resolves true immediately when the file is not locked', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-lock-test-'))
    const filePath = path.join(dir, 'dev.db')
    fs.writeFileSync(filePath, 'x')
    try {
      const result = await waitForFileWritable(filePath, 500, 50)
      expect(result).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves true immediately when the file does not exist yet (fresh install)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-lock-test-'))
    const filePath = path.join(dir, 'dev.db')
    try {
      const result = await waitForFileWritable(filePath, 500, 50)
      expect(result).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- main.test.ts` (from `client/`)
Expected: FAIL with "waitForFileWritable is not a function" (or import error) — it doesn't exist yet.

- [ ] **Step 4: Add `waitForFileWritable` and call it before the backup/migration block**

In `client/electron/main.ts`, add the helper near `waitForPortFree` (same file, same style — a probe loop, not a lock API, because there is no cross-platform Node API for "is another process holding this file open" beyond trying an operation that would fail if so):

```typescript
// On an electron-updater restart, the new instance has no ChildProcess
// handle to the OLD instance (unlike the restore flow's waitForProcessExit,
// which waits on a process THIS instance spawned) — so the only reliable
// check is to actually try opening the file for writing and retry on
// failure, mirroring waitForPortFree's probe-until-free loop.
export async function waitForFileWritable(
  filePath: string,
  timeoutMs = 5_000,
  intervalMs = 150,
): Promise<boolean> {
  if (!fs.existsSync(filePath)) return true
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(filePath, 'r+')
      fs.closeSync(fd)
      return true
    } catch {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  return false
}
```

Then in `startServer`, before the existing `backupDatabaseIfNeeded`/`runMigrations` block:

```typescript
  try {
    // Must happen before the backup, not just before migrations: the backup
    // itself does three non-atomic copyFileSync calls, and a still-writing
    // previous process could make each one individually succeed while the
    // result is internally torn. Best-effort: proceeding after a timeout
    // (rather than aborting) matches this app's existing "a locked file must
    // not block startup forever" posture elsewhere in this function.
    await waitForFileWritable(resolveDatabaseUrl(userDataPath).replace(/^file:/, ''))
    backupDatabaseIfNeeded(
      userDataPath,
      app.getVersion(),
      new Date().toISOString().slice(0, 10),
    )
    await runMigrations(serverCwd, env, app.isPackaged)
    writeBackupMarker(userDataPath, app.getVersion())
  } catch (error) {
```

(Keep everything else in that `try` block exactly as it is today — only the new `waitForFileWritable` call is added before `backupDatabaseIfNeeded`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- main.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/electron/main.ts client/electron/main.test.ts
git commit -m "Wait for the previous process to release dev.db before backup/migration"
```

---

## Task 3: Fix the failure-dialog recovery text and `migrationRunner`'s error message

**Design ref:** §1b

**Files:**
- Modify: `client/electron/main.ts` (the `startServer` failure path and its caller)
- Modify: `server/src/db/migrationRunner.ts`
- Test: `client/electron/main.test.ts`, `server/src/db/migrationRunner.test.ts`

**Interfaces:**
- Consumes: `backupDatabaseIfNeeded`'s return value from Task 1 (already correct: existing complete backup returns its `destDir`, not `null`).
- Produces: `startServer` now returns `{ detail: string; backupPath: string | null }` on failure instead of a bare string, so the caller's dialog can state the real path.

- [ ] **Step 1: Read the current failure path and the migrationRunner error text**

```bash
grep -n "startServer\|showErrorBox\|Startup Failed" client/electron/main.ts
grep -n "migrate resolve\|Resolve it" server/src/db/migrationRunner.ts
```

- [ ] **Step 2: Write a failing test for `migrationRunner`'s corrected error text**

In `server/src/db/migrationRunner.test.ts`, find the existing test that triggers a migration failure (search for `toThrow` or `rejects`) and add/adjust an assertion:

```typescript
  it('a failed migration error message does not reference the Prisma CLI', () => {
    writeMigration('20260101000000_bad', 'THIS IS NOT VALID SQL;')
    expect(() =>
      applyMigrations({ databasePath: dbPath, migrationsDir }),
    ).toThrowError(/prisma migrate resolve/i) // <- inverted on purpose: see step 3
  })
```

(This assertion is written to currently PASS against the old text and FAIL after the fix — confirming the fix actually changes the message. After step 4, invert it to `.not.toThrowError(/prisma migrate resolve/i)` combined with a positive assertion — see step 3.)

- [ ] **Step 3: Run it to confirm today's text still names the CLI, then flip the assertion to the target state**

Run: `npm test -- migrationRunner.test.ts` (from `server/`)
Expected: PASS (proving the old text is there). Now replace that test with the real target-state assertion:

```typescript
  it('a failed migration error message tells the operator to check the backup, not run a CLI that is not shipped', () => {
    writeMigration('20260101000000_bad', 'THIS IS NOT VALID SQL;')
    expect(() => applyMigrations({ databasePath: dbPath, migrationsDir })).toThrowError(
      /back ?up/i,
    )
    expect(() => applyMigrations({ databasePath: dbPath, migrationsDir })).not.toThrowError(
      /prisma migrate resolve/i,
    )
  })
```

Run again — Expected: FAIL (the current text still says `prisma migrate resolve`).

- [ ] **Step 4: Update `migrationRunner.ts`'s failure message**

In `server/src/db/migrationRunner.ts`, find the `throw new Error(...)` for the previously-failed-migration case (currently referencing `prisma migrate resolve`) and change it to:

```typescript
    if (failed) {
      throw new Error(
        `A migration previously failed and was never resolved: "${failed.migration_name}". ` +
          'This database has not been modified further. Restore the pre-migration backup ' +
          '(see the startup failure dialog for its exact location) or contact support before retrying.',
      )
    }
```

- [ ] **Step 5: Run the migrationRunner test to verify it passes**

Run: `npm test -- migrationRunner.test.ts`
Expected: PASS.

- [ ] **Step 6: Write a failing test for the dialog carrying the correct backup path**

In `client/electron/main.test.ts`:

```typescript
  it('a migration failure surfaces the actual backup directory, not a hardcoded pattern', async () => {
    // Arrange: userData with a completed backup already on disk (simulating
    // backupDatabaseIfNeeded having just run), then simulate runMigrations
    // rejecting.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-fail-test-'))
    fs.writeFileSync(path.join(dir, 'dev.db'), 'x')
    const backupDestDir = backupDatabaseIfNeeded(dir, '0.11.0', '2026-08-01')!

    const result = await startServerForTest({
      userDataPath: dir,
      runMigrationsImpl: async () => {
        throw new Error('database migration exited with code 1')
      },
    })

    expect(result.detail).toContain(backupDestDir)
    expect(result.detail).toContain('dev.db-wal')
    expect(result.detail).not.toContain('roll back to the previously-installed version')
    expect(result.detail.toLowerCase()).toContain('support')
    fs.rmSync(dir, { recursive: true, force: true })
  })
```

This test references a `startServerForTest` seam — check `main.test.ts` for how `startServer` is already tested (it likely isn't directly callable due to Electron `app`/`dialog` globals). If no such seam exists yet, extract the failure-detail-building logic in `startServer` into a small, pure, exported function first (see step 7) and test that directly instead of the whole `startServer`.

- [ ] **Step 7: Extract a pure `buildStartupFailureDetail` function and wire it in**

In `client/electron/main.ts`, factor the dialog text out of `startServer`'s catch block into its own exported, pure function:

```typescript
export function buildStartupFailureDetail(
  errorMessage: string,
  backupPath: string | null,
): string {
  const backupInstruction = backupPath
    ? `Your data was backed up before this update ran, at:\n${backupPath}\n\n` +
      `To recover: quit the app, delete "dev.db-wal", "dev.db-journal", and "dev.db-shm" ` +
      `from the app's data folder if present, then copy "dev.db" (and any "dev.db-wal"/` +
      `"dev.db-shm" files) from the backup folder above back into the data folder. ` +
      `Restoring this backup will not by itself fix the update failure — contact support ` +
      `with this message before retrying.`
    : `No backup was needed (this looks like a fresh install). Contact support with this message.`

  return `${errorMessage}\n\n${backupInstruction}`
}
```

Then in `startServer`'s catch block, capture `backupDatabaseIfNeeded`'s return value (it's currently discarded) and use it:

```typescript
  let backupPath: string | null = null
  try {
    await waitForFileWritable(resolveDatabaseUrl(userDataPath).replace(/^file:/, ''))
    backupPath = backupDatabaseIfNeeded(
      userDataPath,
      app.getVersion(),
      new Date().toISOString().slice(0, 10),
    )
    await runMigrations(serverCwd, env, app.isPackaged)
    writeBackupMarker(userDataPath, app.getVersion())
  } catch (error) {
    const detail = buildStartupFailureDetail(
      error instanceof Error ? error.message : String(error),
      backupPath,
    )
    await logError('Database preparation failed:', error)
    dialog.showErrorBox('Startup Failed', detail)
    app.quit()
    return detail
  }
```

Adjust the test from step 6 to call `buildStartupFailureDetail` directly instead of a `startServerForTest` seam:

```typescript
  it('a migration failure surfaces the actual backup directory, not a hardcoded pattern', () => {
    const detail = buildStartupFailureDetail('database migration exited with code 1', '/data/backups/0.11.0')
    expect(detail).toContain('/data/backups/0.11.0')
    expect(detail).toContain('dev.db-wal')
    expect(detail).not.toContain('roll back to the previously-installed version')
    expect(detail.toLowerCase()).toContain('support')
  })

  it('a startup failure with nothing to back up (fresh install) does not print a bogus path', () => {
    const detail = buildStartupFailureDetail('some error', null)
    expect(detail).toContain('fresh install')
    expect(detail).not.toMatch(/backups[\\/]/)
  })
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -- main.test.ts` (from `client/`)
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/electron/main.ts client/electron/main.test.ts server/src/db/migrationRunner.ts server/src/db/migrationRunner.test.ts
git commit -m "Fix migration failure recovery text: no CLI that isn't shipped, real backup path, sidecar cleanup, lead with support"
```

---

## Task 4: Author the `Client.locationId` SQLite migration

**Design ref:** §2

**Files:**
- Modify: `server/prisma/models.prisma`
- Create: `server/prisma/sqlite/migrations/<timestamp>_add_client_location_id/migration.sql`
- Test: `server/src/db/clientLocationMigration.test.ts` (new)

**Interfaces:**
- Produces: `Client.locationId` (required, FK to `Location`) exists in the schema after this migration. `Location.clients` back-relation added. No code changes yet — that's Task 12 — this task is schema-only, verified independently.

- [ ] **Step 1: Update `models.prisma`**

In `server/prisma/models.prisma`, update `Client` and `Location`:

```prisma
model Location {
  id        String   @id @default(uuid())
  name      String
  address   String
  locale    String   @default("pt-BR")
  phone     String?
  createdAt DateTime @default(now())

  maintenanceBufferDays Int @default(0)

  connectivityMode String @default("lan")

  staff                Staff[]
  products             Product[]
  clients              Client[]
  contracts            Contract[]
  contractClauses      LocationContractClause[]
  productPhotoTokens   ProductPhotoToken[]
}
```

```prisma
model Client {
  id         String   @id @default(uuid())
  locationId String
  name       String
  phone      String
  email      String
  notes      String?
  createdAt  DateTime @default(now())

  location          Location                 @relation(fields: [locationId], references: [id])
  allocations       Allocation[]
  identityDocuments ClientIdentityDocument[]
  addressLines      ClientAddressLine[]
  contracts         Contract[]
}
```

(Only the two shown models change; leave every other model untouched.)

- [ ] **Step 2: Regenerate the provider schemas and Prisma client**

```bash
cd server
npm run db:schema
```

Confirm `prisma/sqlite/schema.prisma` and `prisma/postgresql/schema.prisma` both now show `Client.locationId` and `Location.clients`.

- [ ] **Step 3: Get a CLI-generated skeleton to hand-edit (do not use its `INSERT ... SELECT` as-is)**

```bash
npx prisma migrate dev --schema=prisma/sqlite/schema.prisma --create-only --name add_client_location_id
```

This will likely fail or prompt interactively because the column has no default and the table isn't empty in dev — that's expected and fine; the goal is only to see Prisma's normal `RedefineTables` skeleton shape for a `Client` rebuild (existing columns, existing indexes) to copy verbatim, not its data-migration step. If it errors out without writing a file, use the existing `20260725003154_product_photo_token_session_scoped/migration.sql` as the structural reference instead (already read during design) — do not run this against a database with real data.

- [ ] **Step 4: Write the migration file by hand**

Create `server/prisma/sqlite/migrations/<YYYYMMDDHHMMSS>_add_client_location_id/migration.sql` (timestamp prefix matching the existing migrations' naming convention — use the current date/time, e.g. `20260801000000_add_client_location_id`):

```sql
-- Invariant guard: refuse to proceed if more than one Location row exists.
-- Zero or one rows are both fine — Client is necessarily empty when
-- Location is empty (client creation requires an authenticated Staff,
-- which requires a Location) — only more than one is unsafe, since the
-- backfill below has no way to pick the "right" one.
--
-- RAISE() only works inside a SQLite trigger body, not as a plain
-- statement, hence the scratch table/trigger. Cleanup runs at BOTH ends:
-- an idempotent DROP first (in case a previous aborted attempt at this
-- exact migration left debris — this script has no wrapping transaction,
-- so an abort partway leaves everything run so far committed), and a real
-- DROP after the guard passes (this second DROP only executes on success;
-- an abort never reaches it, which is fine, because the NEXT attempt's
-- leading DROP cleans it up then).
DROP TRIGGER IF EXISTS "_location_scoping_guard_trigger";
DROP TABLE IF EXISTS "_location_scoping_guard";

CREATE TABLE "_location_scoping_guard" ("id" INTEGER PRIMARY KEY CHECK ("id" = 1));

CREATE TRIGGER "_location_scoping_guard_trigger"
BEFORE INSERT ON "_location_scoping_guard"
WHEN (SELECT COUNT(*) FROM "Location") > 1
BEGIN
  SELECT RAISE(ABORT, 'add_client_location_id: more than one Location row exists; refusing to backfill Client.locationId. This is not a transient failure — restoring a backup will not fix it. Contact support.');
END;

INSERT INTO "_location_scoping_guard" ("id") VALUES (1);

DROP TRIGGER "_location_scoping_guard_trigger";
DROP TABLE "_location_scoping_guard";

-- Add the column nullable first (SQLite can't add a NOT NULL column with no
-- default to a non-empty table in one step).
ALTER TABLE "Client" ADD COLUMN "locationId" TEXT;

-- Backfill: the guard above already proved at most one Location row exists.
UPDATE "Client" SET "locationId" = (SELECT "id" FROM "Location" LIMIT 1);

-- Rebuild the table to make the column NOT NULL with its FK constraint.
-- PRAGMA foreign_keys=OFF is required outside a transaction for this
-- DROP+RENAME sequence not to cascade-delete ClientIdentityDocument/
-- ClientAddressLine rows (both ON DELETE CASCADE to Client).
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Client_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Client" ("id", "locationId", "name", "phone", "email", "notes", "createdAt")
SELECT "id", "locationId", "name", "phone", "email", "notes", "createdAt" FROM "Client";
DROP TABLE "Client";
ALTER TABLE "new_Client" RENAME TO "Client";

PRAGMA foreign_keys=ON;
```

- [ ] **Step 5: Write failing tests exercising this migration directly through the real migration runner**

Create `server/src/db/clientLocationMigration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { applyMigrations } from './migrationRunner.js'

const REAL_MIGRATIONS_DIR = path.join(import.meta.dirname, '../../prisma/sqlite/migrations')

let dbPath: string

beforeEach(() => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-migration-test-'))
  dbPath = path.join(workDir, 'app.db')
})

afterEach(() => {
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
})

function migrationNamesUpTo(exclude: string): string[] {
  return fs
    .readdirSync(REAL_MIGRATIONS_DIR)
    .filter((name) => fs.statSync(path.join(REAL_MIGRATIONS_DIR, name)).isDirectory())
    .sort()
    .filter((name) => name < exclude)
}

function applyAllRealMigrationsExceptClientLocationId(): string {
  const target = fs
    .readdirSync(REAL_MIGRATIONS_DIR)
    .find((name) => name.endsWith('_add_client_location_id'))!
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'staged-migrations-'))
  for (const name of migrationNamesUpTo(target)) {
    fs.cpSync(path.join(REAL_MIGRATIONS_DIR, name), path.join(stageDir, name), { recursive: true })
  }
  applyMigrations({ databasePath: dbPath, migrationsDir: stageDir })
  fs.rmSync(stageDir, { recursive: true, force: true })
  return target
}

function seedRealisticData(locationCount: number): void {
  const db = new Database(dbPath)
  const locationIds: string[] = []
  for (let i = 0; i < locationCount; i++) {
    const id = `loc-${i}`
    db.prepare(
      `INSERT INTO "Location" ("id", "name", "address") VALUES (?, ?, ?)`,
    ).run(id, `Shop ${i}`, `Address ${i}`)
    locationIds.push(id)
  }
  // Clients pre-date the locationId column, so they're seeded without one —
  // exactly the shape the real live database is in before this migration.
  for (let i = 0; i < 25; i++) {
    db.prepare(
      `INSERT INTO "Client" ("id", "name", "phone", "email") VALUES (?, ?, ?, ?)`,
    ).run(`client-${i}`, `Client ${i}`, `555-000${i}`, `client${i}@example.com`)
  }
  db.close()
}

function applyClientLocationMigration(): void {
  const target = fs
    .readdirSync(REAL_MIGRATIONS_DIR)
    .find((name) => name.endsWith('_add_client_location_id'))!
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'staged-final-migration-'))
  fs.cpSync(path.join(REAL_MIGRATIONS_DIR, target), path.join(stageDir, target), { recursive: true })
  applyMigrations({ databasePath: dbPath, migrationsDir: stageDir })
  fs.rmSync(stageDir, { recursive: true, force: true })
}

describe('add_client_location_id migration', () => {
  it('backfills every existing Client to the sole Location, on realistic non-empty data', () => {
    applyAllRealMigrationsExceptClientLocationId()
    seedRealisticData(1)
    applyClientLocationMigration()

    const db = new Database(dbPath, { readonly: true })
    const rows = db.prepare(`SELECT "id", "locationId" FROM "Client"`).all() as { locationId: string }[]
    db.close()
    expect(rows).toHaveLength(25)
    expect(rows.every((row) => row.locationId === 'loc-0')).toBe(true)
  })

  it('migrates a fresh, empty database (zero Location rows) without the guard firing', () => {
    applyAllRealMigrationsExceptClientLocationId()
    // No seed data at all — this is what every real first launch looks like.
    expect(() => applyClientLocationMigration()).not.toThrow()

    const db = new Database(dbPath, { readonly: true })
    const columns = db.prepare(`PRAGMA table_info("Client")`).all() as { name: string; notnull: number }[]
    db.close()
    const locationIdColumn = columns.find((c) => c.name === 'locationId')
    expect(locationIdColumn?.notnull).toBe(1)
  })

  it('aborts cleanly when more than one Location row exists, leaving Client untouched', () => {
    applyAllRealMigrationsExceptClientLocationId()
    seedRealisticData(2)
    expect(() => applyClientLocationMigration()).toThrow(/more than one Location/)

    const db = new Database(dbPath, { readonly: true })
    const columns = db.prepare(`PRAGMA table_info("Client")`).all() as { name: string }[]
    db.close()
    expect(columns.some((c) => c.name === 'locationId')).toBe(false)
  })

  it('leaves no scratch table or trigger behind on a successful run', () => {
    applyAllRealMigrationsExceptClientLocationId()
    seedRealisticData(1)
    applyClientLocationMigration()

    const db = new Database(dbPath, { readonly: true })
    const scratchTable = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_location_scoping_guard'`)
      .get()
    const scratchTrigger = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='_location_scoping_guard_trigger'`)
      .get()
    db.close()
    expect(scratchTable).toBeUndefined()
    expect(scratchTrigger).toBeUndefined()
  })
})
```

- [ ] **Step 6: Run the tests to verify they fail, then pass**

Run: `npm test -- clientLocationMigration.test.ts` (from `server/`)
Expected: first run FAILs (migration file doesn't exist under that name yet, or fails before step 4's file is in place) — after step 4, re-run:
Expected: PASS, all four cases.

- [ ] **Step 7: Regenerate the Prisma client from the new schema**

```bash
npm run db:generate
```

- [ ] **Step 8: Run the full existing test suite to confirm nothing else broke**

Run: `npm test` (from `server/`)
Expected: every `Client`-touching test that creates a client without a `locationId` now fails — this is expected and is exactly what Task 12 fixes. Note which test files fail here; Task 12 must turn all of them green again.

- [ ] **Step 9: Commit**

```bash
git add server/prisma/models.prisma server/prisma/sqlite/schema.prisma server/prisma/postgresql/schema.prisma server/prisma/sqlite/migrations server/src/generated server/src/db/clientLocationMigration.test.ts
git commit -m "Add hand-authored Client.locationId SQLite migration with invariant guard"
```

---

## Task 5: Author the `Client.locationId` Postgres migration

**Design ref:** §2 ("generating the equivalent Postgres migration alongside it")

**Files:**
- Create: `server/prisma/postgresql/migrations/<timestamp>_add_client_location_id/migration.sql`

**Interfaces:**
- Consumes: `models.prisma`/`prisma/postgresql/schema.prisma` from Task 4 (already updated).
- Produces: schema parity between providers — no runtime behavior change (no live Postgres deployment exists), verified by `prisma migrate diff` reporting no drift.

- [ ] **Step 1: Generate the migration against the Postgres schema**

Postgres supports `ALTER TABLE ... ADD COLUMN ... NOT NULL` with a backfill in a single transactional migration (no RedefineTables dance needed), so the CLI-generated version is usable directly here — unlike SQLite, Postgres migrations in this app run through the real `prisma migrate deploy`, not the custom runner, so there's no matching invariant-guard requirement (that guard exists specifically because the SQLite runner has no rollback safety net; Postgres migrations do, via `prisma migrate deploy`'s transaction).

```bash
cd server
npm run test:postgres:up
DB_PROVIDER=postgresql DATABASE_URL="postgresql://postgres:postgres@localhost:5432/dress_store_test" \
  npx prisma migrate dev --schema=prisma/postgresql/schema.prisma --create-only --name add_client_location_id
```

(Check `.env.test.postgresql` for the actual connection string this repo uses instead of guessing — `cat .env.test.postgresql` — and substitute it above.)

- [ ] **Step 2: Review the generated SQL**

Open the generated `server/prisma/postgresql/migrations/<timestamp>_add_client_location_id/migration.sql` and confirm it does an `ADD COLUMN` + backfill + `SET NOT NULL` + `ADD CONSTRAINT` sequence (Postgres's standard shape for this). No hand-editing should be needed since Postgres doesn't have SQLite's "omits the new column from INSERT...SELECT" problem — this is purely a parity artifact.

- [ ] **Step 3: Verify no schema drift**

```bash
npx prisma migrate diff \
  --from-migrations prisma/postgresql/migrations \
  --to-schema-datamodel prisma/postgresql/schema.prisma \
  --shadow-database-url "postgresql://postgres:postgres@localhost:5432/dress_store_test_shadow"
```

Expected output: no differences reported.

- [ ] **Step 4: Tear down the test Postgres container**

```bash
npm run test:postgres:down
```

- [ ] **Step 5: Commit**

```bash
git add server/prisma/postgresql/migrations
git commit -m "Add Postgres counterpart migration for Client.locationId"
```

---

## Task 6: Build the `scopedDb` guardrail with its model registry

**Design ref:** §4

**Files:**
- Create: `server/src/db/scopedClient.ts`
- Test: `server/src/db/scopedClient.test.ts`

**Interfaces:**
- Produces:
  - `LOCATION_SCOPED_MODELS: readonly ['client', 'product']`
  - `MANUALLY_SCOPED_MODELS: Record<string, string>` (model key → exclusion reason)
  - `MODELS_WITH_LOCATION_ID_COLUMN: ReadonlySet<string>`
  - `scopedDb(locationId: string): ExtendedPrismaClient` — the extended client every later task's routes/services will import instead of the bare `prisma`.
- Consumes: `prisma` from `server/src/db/client.js` (existing).

- [ ] **Step 1: Read the generated Prisma client's extension types to confirm the exact `$allOperations` signature**

```bash
grep -rn "allOperations\|ExtensionArgs" server/src/generated/prisma/internal/prismaNamespace.ts | head -20
```

- [ ] **Step 2: Write failing unit tests for the registry and the extension's scoping behavior**

Create `server/src/db/scopedClient.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from './client.js'
import {
  scopedDb,
  LOCATION_SCOPED_MODELS,
  MANUALLY_SCOPED_MODELS,
  MODELS_WITH_LOCATION_ID_COLUMN,
} from './scopedClient.js'

afterEach(async () => {
  await prisma.allocation.deleteMany()
  await prisma.client.deleteMany()
  await prisma.product.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

async function seedTwoLocations() {
  const locationA = await prisma.location.create({ data: { name: 'A', address: 'A' } })
  const locationB = await prisma.location.create({ data: { name: 'B', address: 'B' } })
  return { locationA, locationB }
}

describe('scopedDb', () => {
  it('scopes findMany to the given locationId', async () => {
    const { locationA, locationB } = await seedTwoLocations()
    await prisma.client.create({ data: { name: 'A client', phone: '1', email: 'a@x.com', locationId: locationA.id } })
    await prisma.client.create({ data: { name: 'B client', phone: '2', email: 'b@x.com', locationId: locationB.id } })

    const dbA = scopedDb(locationA.id)
    const results = await dbA.client.findMany()
    expect(results).toHaveLength(1)
    expect(results[0]!.name).toBe('A client')
  })

  it('scopes create by injecting locationId into data', async () => {
    const { locationA } = await seedTwoLocations()
    const dbA = scopedDb(locationA.id)
    const created = await dbA.client.create({ data: { name: 'New', phone: '1', email: 'n@x.com' } as any })
    expect(created.locationId).toBe(locationA.id)
  })

  it('scopes findUnique so a cross-location id lookup returns null', async () => {
    const { locationA, locationB } = await seedTwoLocations()
    const client = await prisma.client.create({
      data: { name: 'B client', phone: '2', email: 'b@x.com', locationId: locationB.id },
    })
    const dbA = scopedDb(locationA.id)
    const result = await dbA.client.findUnique({ where: { id: client.id } })
    expect(result).toBeNull()
  })

  it('scopes deleteMany, updateMany, and count', async () => {
    const { locationA, locationB } = await seedTwoLocations()
    await prisma.client.create({ data: { name: 'A', phone: '1', email: 'a@x.com', locationId: locationA.id } })
    await prisma.client.create({ data: { name: 'B', phone: '2', email: 'b@x.com', locationId: locationB.id } })
    const dbA = scopedDb(locationA.id)

    expect(await dbA.client.count()).toBe(1)
    await dbA.client.updateMany({ data: { notes: 'touched' } })
    expect((await prisma.client.findMany({ where: { locationId: locationB.id } }))[0]!.notes).toBeNull()
    await dbA.client.deleteMany()
    expect(await prisma.client.count({ where: { locationId: locationB.id } })).toBe(1)
    expect(await prisma.client.count({ where: { locationId: locationA.id } })).toBe(0)
  })

  it('throws on an operation not in the deny-by-default allowlist for a scoped model', async () => {
    const { locationA } = await seedTwoLocations()
    const dbA = scopedDb(locationA.id)
    // groupBy is intentionally unhandled — this codebase never uses it
    // against Client/Product, so it must throw rather than pass through.
    await expect(
      (dbA.client as any).groupBy({ by: ['name'] }),
    ).rejects.toThrow(/unhandled operation/i)
  })

  it('passes through unmodified for a model with no locationId column at all', async () => {
    const { locationA } = await seedTwoLocations()
    const staff = await prisma.staff.create({
      data: { name: 'S', login: 'scoped-test-login', passwordHash: 'x', role: 'owner', locationId: locationA.id },
    })
    const dbA = scopedDb(locationA.id)
    const client = await dbA.client.create({ data: { name: 'C', phone: '1', email: 'c@x.com' } as any })
    // clientIdentityDocument has no locationId column and is not in either
    // registry list — it must pass through untouched, not throw.
    const doc = await dbA.clientIdentityDocument.create({
      data: { clientId: client.id, label: 'CPF', value: '123' },
    })
    expect(doc.id).toBeTruthy()
    await prisma.staff.delete({ where: { id: staff.id } })
  })

  it('throws for a model that carries locationId but is registered in neither list', () => {
    // Regression guard: if someone adds a seventh locationId-bearing model
    // to models.prisma without registering it anywhere, this must be loud.
    const registered = new Set([...LOCATION_SCOPED_MODELS, ...Object.keys(MANUALLY_SCOPED_MODELS)])
    for (const model of MODELS_WITH_LOCATION_ID_COLUMN) {
      expect(registered.has(model)).toBe(true)
    }
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- scopedClient.test.ts` (from `server/`)
Expected: FAIL — `scopedClient.js` doesn't exist yet.

- [ ] **Step 4: Implement `scopedClient.ts`**

Create `server/src/db/scopedClient.ts`:

```typescript
import { prisma } from './client.js'

// Models routed through scopedDb: every query/write against them is
// automatically scoped to the given locationId. Add a model here only if
// its normal access pattern always has a known locationId in hand (i.e. an
// authenticated request, or another already-scoped lookup).
export const LOCATION_SCOPED_MODELS = ['client', 'product'] as const

// Models that carry a locationId column (see MODELS_WITH_LOCATION_ID_COLUMN)
// but are deliberately NOT routed through scopedDb, each with why. These are
// scoped by hand at their own call sites instead.
export const MANUALLY_SCOPED_MODELS: Record<string, string> = {
  staff: 'queried unscoped at login (authRoutes.ts), before any location is known',
  contract: 'already scoped by hand via explicit where: { locationId } clauses in contractService.ts',
  locationContractClause: 'already scoped by hand alongside Contract',
  productPhotoToken: 'looked up by token on unauthenticated paths with no req.staff',
}

// Every model in models.prisma that carries a locationId column, whether or
// not it's routed through scopedDb. Cross-checked against the real schema
// file by a test in this suite (see scopedClient.registry.test.ts) — this
// list is the deny-by-default backstop for Goal 2 ("a new model can't
// reintroduce this bug silently"): a model with a locationId column that
// lands in neither LOCATION_SCOPED_MODELS nor MANUALLY_SCOPED_MODELS throws.
export const MODELS_WITH_LOCATION_ID_COLUMN = new Set([
  'staff',
  'product',
  'contract',
  'productPhotoToken',
  'locationContractClause',
  'client',
])

const OPERATIONS_MERGING_WHERE = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
])

function toModelKey(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1)
}

export function scopedDb(locationId: string) {
  return prisma.$extends({
    name: 'scopedDb',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const modelKey = toModelKey(model)

          if ((LOCATION_SCOPED_MODELS as readonly string[]).includes(modelKey)) {
            const scopedArgs: any = args
            if (operation === 'create') {
              scopedArgs.data = { ...scopedArgs.data, locationId }
            } else if (operation === 'createMany') {
              scopedArgs.data = Array.isArray(scopedArgs.data)
                ? scopedArgs.data.map((row: Record<string, unknown>) => ({ ...row, locationId }))
                : { ...scopedArgs.data, locationId }
            } else if (operation === 'upsert') {
              scopedArgs.where = { ...scopedArgs.where, locationId }
              scopedArgs.create = { ...scopedArgs.create, locationId }
            } else if (OPERATIONS_MERGING_WHERE.has(operation)) {
              scopedArgs.where = { ...scopedArgs.where, locationId }
            } else {
              throw new Error(
                `scopedDb: unhandled operation "${operation}" on scoped model "${model}" — ` +
                  'add explicit handling in scopedClient.ts before using it.',
              )
            }
            return query(scopedArgs)
          }

          if (Object.prototype.hasOwnProperty.call(MANUALLY_SCOPED_MODELS, modelKey)) {
            return query(args)
          }

          if (MODELS_WITH_LOCATION_ID_COLUMN.has(modelKey)) {
            throw new Error(
              `scopedDb: model "${model}" carries a locationId column but is registered in ` +
                'neither LOCATION_SCOPED_MODELS nor MANUALLY_SCOPED_MODELS in scopedClient.ts.',
            )
          }

          return query(args)
        },
      },
    },
  })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- scopedClient.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/db/scopedClient.ts server/src/db/scopedClient.test.ts
git commit -m "Add scopedDb Prisma extension with deny-by-default model registry"
```

---

## Task 7: Test that the model registry actually matches `models.prisma`

**Design ref:** §4 ("one test asserting that registry matches the set of models... in `models.prisma`")

**Files:**
- Test: `server/src/db/scopedClient.registry.test.ts`

**Interfaces:**
- Consumes: `MODELS_WITH_LOCATION_ID_COLUMN`, `LOCATION_SCOPED_MODELS`, `MANUALLY_SCOPED_MODELS` from Task 6.

- [ ] **Step 1: Write the failing test**

Create `server/src/db/scopedClient.registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  LOCATION_SCOPED_MODELS,
  MANUALLY_SCOPED_MODELS,
  MODELS_WITH_LOCATION_ID_COLUMN,
} from './scopedClient.js'

const MODELS_PRISMA_PATH = path.join(import.meta.dirname, '../../prisma/models.prisma')

function modelsWithLocationIdFromSchema(): Set<string> {
  const source = fs.readFileSync(MODELS_PRISMA_PATH, 'utf-8')
  const modelBlocks = [...source.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)]
  const result = new Set<string>()
  for (const [, name, body] of modelBlocks) {
    if (/^\s*locationId\s+String/m.test(body!)) {
      result.add(name!.charAt(0).toLowerCase() + name!.slice(1))
    }
  }
  return result
}

describe('scopedDb model registry vs. models.prisma', () => {
  it('MODELS_WITH_LOCATION_ID_COLUMN matches every model that actually declares a locationId field', () => {
    const fromSchema = modelsWithLocationIdFromSchema()
    expect(MODELS_WITH_LOCATION_ID_COLUMN).toEqual(fromSchema)
  })

  it('every locationId-bearing model is registered in exactly one of the two lists', () => {
    const scoped = new Set(LOCATION_SCOPED_MODELS)
    const manual = new Set(Object.keys(MANUALLY_SCOPED_MODELS))
    for (const model of MODELS_WITH_LOCATION_ID_COLUMN) {
      const inScoped = scoped.has(model)
      const inManual = manual.has(model)
      expect(inScoped || inManual).toBe(true)
      expect(inScoped && inManual).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run to verify it currently passes (Task 6 already built these to match)**

Run: `npm test -- scopedClient.registry.test.ts` (from `server/`)
Expected: PASS. If it fails, `MODELS_WITH_LOCATION_ID_COLUMN` in `scopedClient.ts` is out of sync with `models.prisma` — fix the constant, not the test.

- [ ] **Step 3: Commit**

```bash
git add server/src/db/scopedClient.registry.test.ts
git commit -m "Test that the scopedDb model registry matches models.prisma"
```

---

## Task 8: Add the `ast-grep` lint rule for bare `prisma.client`/`prisma.product`

**Design ref:** §4

**Files:**
- Create: `server/.ast-grep/rules/no-unscoped-location-model.yml` (check for an existing `.ast-grep`/`sgconfig.yml` first and match its location/format)
- Modify: `server/package.json` (add a lint script if none exists for ast-grep)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a CI-runnable `ast-grep scan` check.

- [ ] **Step 1: Check for existing ast-grep config**

```bash
find /home/zhyp/Code/dress-store-app -maxdepth 3 -iname "sgconfig.yml" -o -iname ".ast-grep" 2>/dev/null
cat sgconfig.yml 2>/dev/null
```

If a config already exists, add the rule alongside existing rules following the same structure. If none exists, initialize one scoped to `server/`:

```bash
cd server
ast-grep new
```

(Follow the interactive prompts to create `sgconfig.yml` rooted at `server/`, rules directory `rules/`.)

- [ ] **Step 2: Write the rule**

Create `server/rules/no-unscoped-location-model.yml` (or the path `ast-grep new` created):

```yaml
id: no-unscoped-location-model
language: TypeScript
message: >-
  Use scopedDb(locationId) from server/src/db/scopedClient.ts instead of the
  bare prisma client for Client/Product — see docs/superpowers/specs/2026-07-31-location-scoping-design.md.
  If this call site genuinely has no HTTP session (e.g. a token-based lookup
  that already has its own locationId in hand), route it through
  scopedDb(knownLocationId) instead of prisma directly.
severity: error
rule:
  any:
    - pattern: prisma.client.$METHOD($$$ARGS)
    - pattern: prisma.product.$METHOD($$$ARGS)
files:
  - "src/**/*.ts"
ignores:
  - "src/db/scopedClient.ts"
  - "src/**/*.test.ts"
  - "src/generated/**"
```

- [ ] **Step 3: Run it against the current codebase to see today's violations**

```bash
cd server
ast-grep scan --config sgconfig.yml rules/no-unscoped-location-model.yml
```

Expected: several matches today (every current `prisma.client.*`/`prisma.product.*` call site) — this is expected at this point in the plan; they get fixed in Tasks 12–13 and this rule should report zero matches once those land.

- [ ] **Step 4: Add an npm script to run it**

In `server/package.json`, add to `"scripts"`:

```json
    "lint:location-scoping": "ast-grep scan --config sgconfig.yml rules/no-unscoped-location-model.yml"
```

- [ ] **Step 5: Commit**

```bash
git add server/sgconfig.yml server/rules/no-unscoped-location-model.yml server/package.json
git commit -m "Add ast-grep rule flagging unscoped prisma.client/prisma.product calls"
```

(This will still report violations until Tasks 12–13 land — that's expected; do not try to make it pass yet.)

---

## Task 9: Centralize `locationId` resolution in `requireAuth`

**Design ref:** §3

**Files:**
- Modify: `server/src/auth/authMiddleware.ts`
- Modify: `server/src/routes/contracts.ts` (remove `resolveLocationId`, use `req.staff.locationId`)
- Modify: `server/src/routes/locationSettings.ts` (remove its duplicate lookup)
- Modify: `server/src/routes/products.ts` (remove its duplicate `staff.findUniqueOrThrow` calls)
- Test: `server/src/auth/authMiddleware.test.ts`

**Interfaces:**
- Produces: `req.staff: { staffId: string; role: 'owner' | 'staff'; locationId: string }` — the `locationId` field is new; every downstream route in later tasks reads it directly.
- Consumes: nothing from other tasks (independent of the migration/guardrail work — this only touches `Staff`, which already has `locationId`).

- [ ] **Step 1: Read the current middleware, its type declaration, and all three duplicate-lookup call sites**

```bash
cat server/src/auth/authMiddleware.ts
grep -rn "declare global\|Express.Request\|req.staff" server/src/**/*.ts | grep -v test
grep -n "resolveLocationId\|staff.findUniqueOrThrow" server/src/routes/contracts.ts server/src/routes/locationSettings.ts server/src/routes/products.ts
```

- [ ] **Step 2: Write a failing test for the new `req.staff.locationId`**

In `server/src/auth/authMiddleware.test.ts` (check existing structure and match it — likely constructs a mock `Request`/`Response` and calls `requireAuth` directly):

```typescript
  it('sets req.staff.locationId from the Staff record', async () => {
    const staff = await prisma.staff.create({
      data: { name: 'S', login: `mw-test-${Date.now()}`, passwordHash: 'x', role: 'owner', locationId: location.id },
    })
    const token = signStaffToken({ staffId: staff.id, role: 'owner' })
    const req = { header: (name: string) => (name === 'authorization' ? `Bearer ${token}` : undefined) } as any
    const res = { setHeader: () => {} } as any
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(req.staff).toEqual({ staffId: staff.id, role: 'owner', locationId: location.id })
    expect(next).toHaveBeenCalled()
  })

  it('rejects a token for a staff member who no longer exists', async () => {
    const token = signStaffToken({ staffId: 'does-not-exist', role: 'owner' })
    const req = { header: (name: string) => (name === 'authorization' ? `Bearer ${token}` : undefined) } as any
    const res = { setHeader: () => {} } as any
    const next = vi.fn()

    await expect(requireAuth(req, res, next)).rejects.toThrow(AppError)
    expect(next).not.toHaveBeenCalled()
  })
```

(Match whatever `beforeEach`/location-and-staff-fixture setup the existing test file already has — if none exists yet for this file, add a minimal one creating a `Location` first, matching `clientService.test.ts`'s `afterEach` cleanup style.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- authMiddleware.test.ts` (from `server/`)
Expected: FAIL — `req.staff` currently has no `locationId`, and `requireAuth` is currently synchronous (not `async`), so `await requireAuth(...)` in the test won't behave as expected yet either.

- [ ] **Step 4: Make `requireAuth` async and add the `locationId` lookup**

In `server/src/auth/authMiddleware.ts`:

```typescript
import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import type { VerifiedStaffToken } from './jwt.js'
import { shouldRenewToken, signStaffToken, verifyStaffToken } from './jwt.js'

export const RENEWED_TOKEN_HEADER = 'X-Renewed-Token'
export const RENEWAL_EXCLUDED_PATHS = new Set(['/api/products/events/ticket'])
export const BACKGROUND_REQUEST_HEADER = 'X-Background-Request'

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.header('authorization')
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Missing or malformed Authorization header')
  }

  const token = header.slice('Bearer '.length)
  let payload: VerifiedStaffToken
  try {
    payload = verifyStaffToken(token)
  } catch {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Invalid or expired token')
  }

  // findUniqueOrThrow, not findUnique: a token for a staff member deleted
  // after the token was issued must fail here, not proceed with an
  // undefined locationId.
  let staff
  try {
    staff = await prisma.staff.findUniqueOrThrow({ where: { id: payload.staffId } })
  } catch {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Staff account no longer exists')
  }
  req.staff = { staffId: staff.id, role: staff.role as 'owner' | 'staff', locationId: staff.locationId }

  const isBackgroundRequest =
    req.header(BACKGROUND_REQUEST_HEADER) !== undefined ||
    RENEWAL_EXCLUDED_PATHS.has(req.baseUrl + req.path)

  if (shouldRenewToken(payload, Date.now()) && !isBackgroundRequest) {
    res.setHeader(
      RENEWED_TOKEN_HEADER,
      signStaffToken({ staffId: payload.staffId, role: payload.role }),
    )
  }

  next()
}
```

Find the `declare global` block extending `Express.Request` with `staff` (likely in a `.d.ts` file — search for it) and add `locationId: string` to the type:

```bash
grep -rln "staff?:.*staffId" server/src --include="*.d.ts" --include="*.ts"
```

Update that declaration to:

```typescript
declare global {
  namespace Express {
    interface Request {
      staff?: { staffId: string; role: 'owner' | 'staff'; locationId: string }
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- authMiddleware.test.ts`
Expected: PASS.

- [ ] **Step 6: Remove the three duplicated per-route lookups**

In `server/src/routes/contracts.ts`: delete `resolveLocationId` and its calls; replace every `const locationId = await resolveLocationId(req.staff.staffId)` with `const locationId = req.staff!.locationId`.

In `server/src/routes/locationSettings.ts`: apply the same replacement for its equivalent lookup.

In `server/src/routes/products.ts`: replace both `const staff = await prisma.staff.findUniqueOrThrow({ where: { id: req.staff.staffId } })` call sites (`photo-session` and `events/ticket` routes) with direct reads of `req.staff!.locationId` — keep any other use of the fetched `staff` object (e.g. `staff.id`) as `req.staff!.staffId` instead.

- [ ] **Step 7: Run the full server test suite**

Run: `npm test` (from `server/`)
Expected: `contracts.test.ts`, `locationSettings` tests, and `products.test.ts` all still PASS (behavior is identical, just sourced differently) — the `Client`-related failures from Task 4 Step 8 are still expected at this point and unrelated to this task.

- [ ] **Step 8: Commit**

```bash
git add server/src/auth/authMiddleware.ts server/src/auth/authMiddleware.test.ts server/src/routes/contracts.ts server/src/routes/locationSettings.ts server/src/routes/products.ts
git commit -m "Centralize locationId resolution in requireAuth, remove duplicated per-route lookups"
```

---

## Task 10: Build the shared two-location test fixture

**Design ref:** §4 ("Shared test setup seeds two locations with data in each by default")

**Files:**
- Create: `server/src/testHelpers/twoLocationFixture.ts`
- Test: `server/src/testHelpers/twoLocationFixture.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  interface TwoLocationFixture {
    locationA: Location; locationB: Location
    staffA: Staff; staffB: Staff       // password: 'fixture-password12'
    productA: Product; productB: Product
    clientA: Client; clientB: Client
  }
  async function seedTwoLocations(): Promise<TwoLocationFixture>
  async function expectNotFoundAcrossLocations(request: () => Promise<unknown>): Promise<void>
  ```
- Consumes: `prisma` from `server/src/db/client.js`, `hashPassword` from `server/src/auth/passwords.js` (existing).

- [ ] **Step 1: Read an existing integration test for the request/auth pattern to match**

```bash
sed -n '1,60p' server/tests/integration/happyPath.test.ts
```

- [ ] **Step 2: Write a failing test for the fixture helper itself**

Create `server/src/testHelpers/twoLocationFixture.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { seedTwoLocations, expectNotFoundAcrossLocations } from './twoLocationFixture.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

afterEach(async () => {
  await prisma.allocation.deleteMany()
  await prisma.client.deleteMany()
  await prisma.product.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('seedTwoLocations', () => {
  it('creates two fully independent locations with their own staff/product/client', async () => {
    const fixture = await seedTwoLocations()
    expect(fixture.locationA.id).not.toBe(fixture.locationB.id)
    expect(fixture.staffA.locationId).toBe(fixture.locationA.id)
    expect(fixture.staffB.locationId).toBe(fixture.locationB.id)
    expect(fixture.productA.locationId).toBe(fixture.locationA.id)
    expect(fixture.clientA.locationId).toBe(fixture.locationA.id)
  })
})

describe('expectNotFoundAcrossLocations', () => {
  it('passes when the request throws a 404 AppError', async () => {
    await expectNotFoundAcrossLocations(async () => {
      throw new AppError(ErrorCodes.NOT_FOUND, 404, 'nope')
    })
  })

  it('fails when the request does not throw', async () => {
    await expect(
      expectNotFoundAcrossLocations(async () => 'unexpectedly succeeded'),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- twoLocationFixture.test.ts` (from `server/`)
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 4: Implement the fixture**

Create `server/src/testHelpers/twoLocationFixture.ts`:

```typescript
import { expect } from 'vitest'
import { prisma } from '../db/client.js'
import { hashPassword } from '../auth/passwords.js'
import { AppError } from '../errors/AppError.js'

export async function seedTwoLocations() {
  const locationA = await prisma.location.create({ data: { name: 'Location A', address: 'A St' } })
  const locationB = await prisma.location.create({ data: { name: 'Location B', address: 'B St' } })

  const passwordHash = await hashPassword('fixture-password12')
  const staffA = await prisma.staff.create({
    data: { name: 'Staff A', login: `fixture-a-${Date.now()}`, passwordHash, role: 'owner', locationId: locationA.id },
  })
  const staffB = await prisma.staff.create({
    data: { name: 'Staff B', login: `fixture-b-${Date.now()}`, passwordHash, role: 'owner', locationId: locationB.id },
  })

  const productA = await prisma.product.create({
    data: {
      locationId: locationA.id,
      name: 'Product A',
      category: 'dress',
      size: 'M',
      color: 'red',
      rentalPrice: 100,
      depositAmount: 50,
    },
  })
  const productB = await prisma.product.create({
    data: {
      locationId: locationB.id,
      name: 'Product B',
      category: 'dress',
      size: 'M',
      color: 'blue',
      rentalPrice: 100,
      depositAmount: 50,
    },
  })

  const clientA = await prisma.client.create({
    data: { locationId: locationA.id, name: 'Client A', phone: '1', email: 'a@fixture.com' },
  })
  const clientB = await prisma.client.create({
    data: { locationId: locationB.id, name: 'Client B', phone: '2', email: 'b@fixture.com' },
  })

  return { locationA, locationB, staffA, staffB, productA, productB, clientA, clientB }
}

// Shared assertion for "staff at location A can't see/touch location B's
// resource" — every resource task in this plan reuses this exact check so
// the isolation contract is asserted identically everywhere.
export async function expectNotFoundAcrossLocations(request: () => Promise<unknown>): Promise<void> {
  await expect(request()).rejects.toMatchObject({
    constructor: AppError,
    statusCode: 404,
  })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- twoLocationFixture.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/testHelpers/twoLocationFixture.ts server/src/testHelpers/twoLocationFixture.test.ts
git commit -m "Add shared two-location cross-isolation test fixture"
```

---

## Task 11: Update `contractService.ts`'s existing tests/usages for the new `req.staff.locationId` shape

**Design ref:** §3 (consistency check — `contractService.ts` already took `locationId` as an explicit parameter and is unaffected in behavior, but its route now sources that parameter differently per Task 9)

**Files:**
- Test: `server/src/routes/contracts.test.ts`

**Interfaces:**
- Consumes: Task 9's `req.staff.locationId`.

- [ ] **Step 1: Run the existing contracts test suite to confirm Task 9 didn't change behavior**

Run: `npm test -- contracts.test.ts` (from `server/`)
Expected: PASS, unchanged — this task is a verification checkpoint, not new functionality. `contractService.ts` itself needs no changes; it already takes `locationId` explicitly.

- [ ] **Step 2: If any test asserted on `resolveLocationId` internals directly (rather than through the route), update it to go through the route/HTTP layer instead**

```bash
grep -n "resolveLocationId" server/src/routes/contracts.test.ts
```

If nothing matches, no change needed — proceed. If something does, replace the direct internal call with an HTTP-level assertion via the existing test app/supertest pattern already used elsewhere in that file.

- [ ] **Step 3: Commit (only if Step 2 required a change)**

```bash
git add server/src/routes/contracts.test.ts
git commit -m "Verify contracts route tests against centralized locationId resolution"
```

---

## Task 12: Scope `Client` routes and service through `scopedDb`

**Design ref:** §5 (Client), §2 rollout note (ships in the same release as the migration)

**Files:**
- Modify: `server/src/services/clientService.ts`
- Modify: `server/src/routes/clients.ts`
- Test: `server/src/services/clientService.test.ts`
- Test: `server/src/routes/clients.test.ts` (create if it doesn't exist — check first)

**Interfaces:**
- Consumes: `scopedDb` from Task 6, `req.staff.locationId` from Task 9, `Client.locationId` column from Task 4, `seedTwoLocations`/`expectNotFoundAcrossLocations` from Task 10.
- Produces: every `clientService` function now takes `locationId: string` as its first parameter — this is the signature later tasks (Task 15's Contract→Client check) rely on: `getClient(locationId: string, id: string): Promise<ClientDTO>` (throws 404 on mismatch, matching `contractService.getContract`'s existing pattern).

- [ ] **Step 1: Read the current `clientService.ts` and `routes/clients.ts` in full (already read earlier this session — re-confirm nothing has drifted)**

```bash
cat server/src/services/clientService.ts server/src/routes/clients.ts
```

- [ ] **Step 2: Update `clientService.test.ts`'s existing tests to the new signature (red first)**

Every existing test in `server/src/services/clientService.test.ts` currently calls e.g. `createClient({ name, phone, email })` and `getClient(id)`. Update them all to seed a `Location` and pass `locationId` as described below, then add new cross-location tests:

```typescript
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import {
  createClient,
  listClients,
  getClient,
  updateClient,
  deleteClient,
} from './clientService.js'

let locationId: string
let otherLocationId: string

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  locationId = location.id
  const other = await prisma.location.create({ data: { name: 'L2', address: 'A2' } })
  otherLocationId = other.id
})

afterEach(async () => {
  await prisma.allocation.deleteMany()
  await prisma.client.deleteMany()
  await prisma.product.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('clientService', () => {
  it('creates and fetches a client scoped to a location', async () => {
    const created = await createClient(locationId, {
      name: 'Maria Silva',
      phone: '11999990000',
      email: 'maria@example.com',
    })
    expect(created.locationId).toBe(locationId)

    const fetched = await getClient(locationId, created.id)
    expect(fetched.name).toBe('Maria Silva')
  })

  it('lists only clients belonging to the given location', async () => {
    await createClient(locationId, { name: 'Maria', phone: '1', email: 'a@example.com' })
    await createClient(otherLocationId, { name: 'Elsewhere', phone: '9', email: 'z@example.com' })

    const clients = await listClients(locationId)
    expect(clients).toHaveLength(1)
    expect(clients[0]!.name).toBe('Maria')
  })

  it('throws NOT_FOUND for a missing client', async () => {
    await expect(getClient(locationId, 'does-not-exist')).rejects.toThrow(AppError)
  })

  it('throws NOT_FOUND when fetching a client that belongs to another location', async () => {
    const created = await createClient(otherLocationId, { name: 'Elsewhere', phone: '9', email: 'z@example.com' })
    await expect(getClient(locationId, created.id)).rejects.toThrow(AppError)
  })

  it('updates a client', async () => {
    const created = await createClient(locationId, { name: 'Maria', phone: '1', email: 'a@example.com' })
    const updated = await updateClient(locationId, created.id, { phone: '2' })
    expect(updated.phone).toBe('2')
  })

  it('refuses to update a client belonging to another location', async () => {
    const created = await createClient(otherLocationId, { name: 'Elsewhere', phone: '9', email: 'z@example.com' })
    await expect(updateClient(locationId, created.id, { phone: '2' })).rejects.toThrow(AppError)
  })

  it('deletes a client with no allocation history', async () => {
    const created = await createClient(locationId, { name: 'Maria', phone: '1', email: 'a@example.com' })
    await deleteClient(locationId, created.id)
    await expect(getClient(locationId, created.id)).rejects.toThrow(AppError)
  })

  it('refuses to delete a client belonging to another location', async () => {
    const created = await createClient(otherLocationId, { name: 'Elsewhere', phone: '9', email: 'z@example.com' })
    await expect(deleteClient(locationId, created.id)).rejects.toThrow(AppError)
  })
})
```

(Keep every other existing test in the file — identity documents, address lines, `hasAllocationHistory` — updating each call site the same way: add `locationId,` as the first argument. Do not delete test coverage; only add the `locationId` parameter and the new cross-location cases shown above.)

- [ ] **Step 3: Run to verify failures**

Run: `npm test -- clientService.test.ts` (from `server/`)
Expected: FAIL — current functions don't accept a `locationId` parameter yet.

- [ ] **Step 4: Rewrite `clientService.ts` to take `locationId` and use `scopedDb`**

```typescript
import { scopedDb } from '../db/scopedClient.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { prisma } from '../db/client.js'

// ... (keep all existing type/interface declarations: IdentityDocumentInput,
// AddressLineInput, CreateClientInput, UpdateClientInput, IdentityDocumentDTO,
// AddressLineDTO, ClientDTO, ClientRow, CLIENT_INCLUDE, toDTO — unchanged)

async function hasHistory(clientId: string): Promise<boolean> {
  // Allocation has no locationId column — it's reached via product/client
  // relations, so this stays on the bare prisma client (Allocation isn't in
  // scopedDb's registry; see scopedClient.ts).
  const count = await prisma.allocation.count({ where: { clientId } })
  return count > 0
}

async function historyByClientId(clientIds: string[]): Promise<Set<string>> {
  const result = new Set<string>()
  if (clientIds.length === 0) return result
  const allocations = await prisma.allocation.findMany({
    where: { clientId: { in: clientIds } },
    select: { clientId: true },
    distinct: ['clientId'],
  })
  for (const allocation of allocations) {
    result.add(allocation.clientId)
  }
  return result
}

export async function createClient(locationId: string, data: CreateClientInput): Promise<ClientDTO> {
  const row = await scopedDb(locationId).client.create({
    data: {
      name: data.name,
      phone: data.phone,
      email: data.email,
      notes: data.notes,
      identityDocuments: data.identityDocuments ? { create: data.identityDocuments } : undefined,
      addressLines: data.addressLines ? { create: data.addressLines } : undefined,
    } as any,
    include: CLIENT_INCLUDE,
  })
  return toDTO(row, false)
}

export async function listClients(locationId: string): Promise<ClientDTO[]> {
  const rows = await scopedDb(locationId).client.findMany({
    orderBy: { createdAt: 'desc' },
    include: CLIENT_INCLUDE,
  })
  const withHistory = await historyByClientId(rows.map((row) => row.id))
  return rows.map((row) => toDTO(row, withHistory.has(row.id)))
}

export async function getClient(locationId: string, id: string): Promise<ClientDTO> {
  const row = await scopedDb(locationId).client.findUnique({ where: { id }, include: CLIENT_INCLUDE })
  if (!row) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Client ${id} not found`)
  }
  return toDTO(row, await hasHistory(id))
}

export async function updateClient(locationId: string, id: string, data: UpdateClientInput): Promise<ClientDTO> {
  await getClient(locationId, id)
  const db = scopedDb(locationId)

  await prisma.$transaction(async (tx) => {
    // clientIdentityDocument/clientAddressLine carry no locationId column —
    // they pass through scopedDb unmodified (see scopedClient.ts), but the
    // top-level update below still needs the extended client so its own
    // where clause stays scoped. getClient above already proved this id
    // belongs to locationId, so a plain tx.client.update by id here is safe.
    await tx.client.update({
      where: { id },
      data: { name: data.name, phone: data.phone, email: data.email, notes: data.notes },
    })

    if (data.identityDocuments !== undefined) {
      await tx.clientIdentityDocument.deleteMany({ where: { clientId: id } })
      if (data.identityDocuments.length > 0) {
        await tx.clientIdentityDocument.createMany({
          data: data.identityDocuments.map((doc) => ({ ...doc, clientId: id })),
        })
      }
    }

    if (data.addressLines !== undefined) {
      await tx.clientAddressLine.deleteMany({ where: { clientId: id } })
      if (data.addressLines.length > 0) {
        await tx.clientAddressLine.createMany({
          data: data.addressLines.map((line) => ({ ...line, clientId: id })),
        })
      }
    }
  })

  return getClient(locationId, id)
}

export async function deleteClient(locationId: string, id: string): Promise<void> {
  await getClient(locationId, id)
  if (await hasHistory(id)) {
    throw new AppError(
      ErrorCodes.CANNOT_DELETE_WITH_HISTORY,
      409,
      'Cannot delete a client with allocation history',
    )
  }
  await scopedDb(locationId).client.delete({ where: { id } })
}
```

Note: `updateClient`'s transaction uses the **bare** `prisma.$transaction`, not `scopedDb(locationId).$transaction` — because `getClient(locationId, id)` at the top already throws 404 if `id` doesn't belong to `locationId`, the subsequent by-id operations inside the transaction are already safe without needing the extension's own scoping. (Using the extended client's `$transaction` here would also work per the design's `$allOperations`-on-`tx`-delegates behavior, but isn't necessary given the upfront ownership check, and avoids interacting with `scopedDb`'s deny-by-default rule for `clientIdentityDocument`/`clientAddressLine`, which — per Task 6 — pass through unmodified either way.)

- [ ] **Step 5: Update `routes/clients.ts` to source `locationId` from `req.staff`**

```typescript
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/authMiddleware.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { createClient, listClients, getClient, updateClient, deleteClient } from '../services/clientService.js'

export const clientsRouter = Router()
clientsRouter.use(requireAuth)

// ... (keep identityDocumentSchema, addressLineSchema, createSchema, updateSchema unchanged)

clientsRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid client payload')
  }
  const client = await createClient(req.staff!.locationId, parsed.data)
  res.status(201).json(client)
})

clientsRouter.get('/', async (req, res) => {
  res.json(await listClients(req.staff!.locationId))
})

clientsRouter.get('/:id', async (req, res) => {
  res.json(await getClient(req.staff!.locationId, req.params.id))
})

clientsRouter.patch('/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid client payload')
  }
  res.json(await updateClient(req.staff!.locationId, req.params.id, parsed.data))
})

clientsRouter.delete('/:id', async (req, res) => {
  await deleteClient(req.staff!.locationId, req.params.id)
  res.status(204).send()
})
```

- [ ] **Step 6: Run the service tests to verify they pass**

Run: `npm test -- clientService.test.ts`
Expected: PASS.

- [ ] **Step 7: Write and run route-level cross-location isolation tests**

Create (or extend, if it exists) `server/src/routes/clients.test.ts` using the Task 10 fixture and the existing supertest app pattern from `contracts.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '../db/client.js'
import { signStaffToken } from '../auth/jwt.js'
import { seedTwoLocations } from '../testHelpers/twoLocationFixture.js'

afterEach(async () => {
  await prisma.allocation.deleteMany()
  await prisma.client.deleteMany()
  await prisma.product.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('GET/PATCH/DELETE /api/clients/:id cross-location isolation', () => {
  it('404s when staff at location A requests location B\'s client', async () => {
    const { staffA, clientB } = await seedTwoLocations()
    const token = signStaffToken({ staffId: staffA.id, role: 'owner' })

    const getRes = await request(app).get(`/api/clients/${clientB.id}`).set('Authorization', `Bearer ${token}`)
    expect(getRes.status).toBe(404)

    const patchRes = await request(app)
      .patch(`/api/clients/${clientB.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '999' })
    expect(patchRes.status).toBe(404)

    const deleteRes = await request(app).delete(`/api/clients/${clientB.id}`).set('Authorization', `Bearer ${token}`)
    expect(deleteRes.status).toBe(404)
  })

  it('does not include location B\'s clients in location A\'s list', async () => {
    const { staffA, clientA } = await seedTwoLocations()
    const token = signStaffToken({ staffId: staffA.id, role: 'owner' })

    const res = await request(app).get('/api/clients').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.map((c: { id: string }) => c.id)).toEqual([clientA.id])
  })

  it('a created client is assigned to the creating staff\'s location, not a client-supplied one', async () => {
    const { staffA, locationA } = await seedTwoLocations()
    const token = signStaffToken({ staffId: staffA.id, role: 'owner' })

    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Client', phone: '1', email: 'n@example.com' })
    expect(res.status).toBe(201)
    expect(res.body.locationId).toBe(locationA.id)
  })
})
```

(Check `server/src/app.ts` exports an `app` usable with `supertest` this way — match whatever `contracts.test.ts` or `happyPath.test.ts` already does for HTTP-level tests exactly, adjusting the import if the actual pattern differs.)

- [ ] **Step 8: Run the route tests and the ast-grep rule to verify Client is fully closed**

```bash
cd server
npm test -- clients.test.ts
npm run lint:location-scoping
```

Expected: tests PASS; the lint rule no longer reports any `prisma.client.*` matches (only `prisma.product.*` remains, fixed in Task 13).

- [ ] **Step 9: Commit**

```bash
git add server/src/services/clientService.ts server/src/services/clientService.test.ts server/src/routes/clients.ts server/src/routes/clients.test.ts
git commit -m "Scope Client routes and service through scopedDb"
```

---

## Task 13: Scope `Product` routes and service through `scopedDb`

**Design ref:** §5 (Product)

**Files:**
- Modify: `server/src/services/productService.ts`
- Modify: `server/src/routes/products.ts`
- Test: `server/src/services/productService.test.ts`
- Test: `server/src/routes/products.test.ts`

**Interfaces:**
- Consumes: `scopedDb`, `req.staff.locationId`, `seedTwoLocations`/`expectNotFoundAcrossLocations`.
- Produces: `getProduct(locationId: string, id: string)`, `updateProduct(locationId, id, data)`, `deleteProduct(locationId, id)`, `listProducts(locationId: string)` — `createProduct` and `listProductsForLocation` keep taking `locationId` as an explicit parameter (unchanged shape) since they already have non-HTTP callers; only the route derives that parameter differently now.

- [ ] **Step 1: Read the current `productService.ts` and `routes/products.ts` in full**

```bash
cat server/src/services/productService.ts server/src/routes/products.ts
```

- [ ] **Step 2: Update `productService.test.ts` to the new scoped signatures (red first)**

Follow the exact same pattern as Task 12 Step 2: add a `beforeEach` seeding two `Location`s, thread `locationId` into every `getProduct`/`updateProduct`/`deleteProduct`/`listProducts` call, and add cross-location 404 tests for each, e.g.:

```typescript
  it('throws NOT_FOUND when fetching a product that belongs to another location', async () => {
    const created = await createProduct({ locationId: otherLocationId, name: 'X', category: 'dress', size: 'M', color: 'red', rentalPrice: 10, depositAmount: 5 })
    await expect(getProduct(locationId, created.id)).rejects.toThrow(AppError)
  })

  it('lists only products belonging to the given location', async () => {
    await createProduct({ locationId, name: 'A', category: 'dress', size: 'M', color: 'red', rentalPrice: 10, depositAmount: 5 })
    await createProduct({ locationId: otherLocationId, name: 'B', category: 'dress', size: 'M', color: 'blue', rentalPrice: 10, depositAmount: 5 })
    const products = await listProducts(locationId)
    expect(products).toHaveLength(1)
    expect(products[0]!.name).toBe('A')
  })
```

`createProduct`'s existing tests (which already pass `locationId` inside its input object) don't need signature changes — only `getProduct`/`updateProduct`/`deleteProduct`/`listProducts` gain a leading `locationId` parameter, exactly like Task 12.

- [ ] **Step 3: Run to verify failures**

Run: `npm test -- productService.test.ts` (from `server/`)
Expected: FAIL.

- [ ] **Step 4: Rewrite `productService.ts`**

Keep `createProduct` exactly as-is (still takes `CreateProductInput` with `locationId` inside it, still uses `prisma.product.create` — not `scopedDb`, because it has non-HTTP callers as noted in the design; scoping it via a caller-verified route is handled in Step 5 below). Change `listProducts`, `getProduct`, `updateProduct`, `deleteProduct` to take `locationId` and route through `scopedDb`:

```typescript
import { scopedDb } from '../db/scopedClient.js'
// ... (keep prisma import for allocation/occupancy calls, keep all existing type declarations)

export async function listProducts(locationId: string): Promise<ProductDTO[]> {
  const rows = await scopedDb(locationId).product.findMany({ orderBy: { createdAt: 'desc' } })
  const availability = await availabilityByProductId(rows.map((row) => row.id))
  const withHistory = await historyByProductId(rows.map((row) => row.id))
  return rows.map((row) =>
    toDTO(row, availability.get(row.id) ?? 'available', withHistory.has(row.id)),
  )
}

// listProductsForLocation is unchanged (already takes locationId explicitly
// and already filters by it — this was the one function in this file that
// was already correct before this plan).

export async function getProduct(locationId: string, id: string): Promise<ProductDTO> {
  const row = await scopedDb(locationId).product.findUnique({ where: { id } })
  if (!row) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${id} not found`)
  }
  return toDTO(row, await availabilityFor(id), await hasHistory(id))
}

export async function updateProduct(locationId: string, id: string, data: UpdateProductInput): Promise<ProductDTO> {
  await getProduct(locationId, id)
  const row = await scopedDb(locationId).product.update({
    where: { id },
    data: {
      ...data,
      photos: data.photos ? JSON.stringify(data.photos) : undefined,
    } as any,
  })
  return toDTO(row, await availabilityFor(id), await hasHistory(id))
}

export async function deleteProduct(locationId: string, id: string): Promise<void> {
  await getProduct(locationId, id)
  const allocationCount = await prisma.allocation.count({ where: { productId: id } })
  if (allocationCount > 0) {
    throw new AppError(
      ErrorCodes.CANNOT_DELETE_WITH_HISTORY,
      409,
      'Cannot delete a product with allocation history',
    )
  }
  await scopedDb(locationId).product.delete({ where: { id } })
}
```

Also delete the now-stale comment above `listProducts`'s old body (the one asserting `GET /api/products` "lists every location" as deliberate design) — that assumption is exactly what this task removes.

- [ ] **Step 5: Update `routes/products.ts`**

Remove the client-supplied `locationId` from `createSchema` and derive it from `req.staff` at the route, not inside the service:

```typescript
const createSchema = productCreateSchema.extend({
  photos: z.array(z.string()).optional(),
})
// locationId removed from the schema — it now always comes from the
// authenticated staff member, never the request body.

productsRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid product payload')
  }
  res.status(201).json(await createProduct({ ...parsed.data, locationId: req.staff!.locationId }))
})

productsRouter.get('/', async (req, res) => {
  res.json(await listProducts(req.staff!.locationId))
})

productsRouter.get('/:id', async (req, res) => {
  res.json(await getProduct(req.staff!.locationId, req.params.id))
})

productsRouter.patch('/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid product payload')
  }
  res.json(await updateProduct(req.staff!.locationId, req.params.id, parsed.data))
})

productsRouter.delete('/:id', async (req, res) => {
  await deleteProduct(req.staff!.locationId, req.params.id)
  res.status(204).send()
})
```

(Leave `photo-session`, `events/ticket`, and the photo-serving route untouched here — `photo-session`/`events/ticket` already use `req.staff!.locationId` after Task 9; the photo-serving route is fixed in Task 17.)

- [ ] **Step 6: Run the service tests, then update and run route tests**

```bash
cd server
npm test -- productService.test.ts
```
Expected: PASS.

Update `server/src/routes/products.test.ts`'s existing tests the same way Task 12 Step 7 did for clients (thread the fixture, assert 404 on cross-location `GET`/`PATCH`/`DELETE`, assert list only returns the caller's location, assert a created product's `locationId` matches the creating staff's location regardless of any `locationId` sent in the body):

```typescript
  it('ignores a client-supplied locationId and uses the authenticated staff\'s own', async () => {
    const { staffA, locationA, locationB } = await seedTwoLocations()
    const token = signStaffToken({ staffId: staffA.id, role: 'owner' })

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ locationId: locationB.id, name: 'X', category: 'dress', size: 'M', color: 'red', rentalPrice: 10, depositAmount: 5 })
    expect(res.status).toBe(201)
    expect(res.body.locationId).toBe(locationA.id)
  })
```

Run: `npm test -- products.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the lint rule to confirm zero remaining matches**

```bash
npm run lint:location-scoping
```
Expected: no matches (aside from the intentional exemption list in the rule's `ignores`).

- [ ] **Step 8: Commit**

```bash
git add server/src/services/productService.ts server/src/services/productService.test.ts server/src/routes/products.ts server/src/routes/products.test.ts
git commit -m "Scope Product routes and service through scopedDb"
```

---

## Task 14: Scope `Allocation` through the `Product` relation

**Design ref:** §5 (Allocation), §4 (`occupancyQuery.ts` caller-verification requirement)

**Files:**
- Modify: `server/src/services/allocationService.ts`
- Modify: `server/src/routes/allocations.ts`
- Test: `server/src/services/allocationService.test.ts`
- Test: `server/src/routes/allocations.test.ts`

**Interfaces:**
- Consumes: `req.staff.locationId`, `productService.getProduct(locationId, id)` from Task 13 (used here to verify a `productId` belongs to the caller's location before delegating to `occupancyQuery.ts`).
- Produces: every exported `allocationService` function gains a leading `locationId: string` parameter.

- [ ] **Step 1: Read the current `allocationService.ts`, `routes/allocations.ts`, and `occupancyQuery.ts`**

```bash
cat server/src/services/allocationService.ts server/src/routes/allocations.ts server/src/services/occupancyQuery.ts
```

- [ ] **Step 2: Update `allocationService.test.ts` (red first)**

Add a `locationId` fixture (same `beforeEach` pattern as Tasks 12–13) and thread it through every call; add cross-location cases for each of the six functions, e.g.:

```typescript
  it('throws NOT_FOUND checking out an allocation belonging to another location', async () => {
    // set up an allocation whose product belongs to otherLocationId
    // (via a direct prisma.allocation.create in the test, referencing a
    // product created under otherLocationId)
    ...
    await expect(checkOutAllocation(locationId, allocation.id, {})).rejects.toThrow(AppError)
  })
```

(Write one such case per function — `checkOutAllocation`, `returnAllocation`, `cancelAllocation`, `getProductAvailability`, `isProductAvailableForRange`, and a `listAllocations` case asserting only the caller's location's rows come back.)

- [ ] **Step 3: Run to verify failures**

Run: `npm test -- allocationService.test.ts` (from `server/`)
Expected: FAIL.

- [ ] **Step 4: Rewrite `allocationService.ts`**

```typescript
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { isOccupiedForRange, derivedAvailability } from '../domain/occupancy.js'
import {
  blockingAllocationsWhere,
  loadBlockingWindows,
  maintenanceBufferForProduct,
  toWindow,
} from './occupancyQuery.js'

// Allocation has no locationId column of its own — location is reached via
// the product relation. This is the one join scopedDb can't cover (it only
// intercepts top-level delegate calls), so every function here checks
// ownership explicitly, matching contractService.ts's existing pattern.
async function getAllocationOrThrow(locationId: string, id: string) {
  const allocation = await prisma.allocation.findUnique({ where: { id }, include: { product: true } })
  if (!allocation || allocation.product.locationId !== locationId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Allocation ${id} not found`)
  }
  return allocation
}

export interface CheckOutInput {
  conditionNotesOut?: string
  depositCollected?: number
  allowEarly?: boolean
}

export async function checkOutAllocation(
  locationId: string,
  id: string,
  data: CheckOutInput,
  asOf: Date = new Date(),
) {
  const allocation = await getAllocationOrThrow(locationId, id)
  if (allocation.status !== 'reserved') {
    throw new AppError(
      ErrorCodes.INVALID_ALLOCATION_TRANSITION,
      409,
      `Cannot check out an allocation with status ${allocation.status}`,
    )
  }
  if (!data.allowEarly && asOf.getTime() < allocation.checkoutDate.getTime()) {
    throw new AppError(
      ErrorCodes.CHECKOUT_TOO_EARLY,
      409,
      'Cannot check out before the allocation\'s checkout date',
    )
  }
  if (asOf.getTime() < allocation.checkoutDate.getTime()) {
    const maintenanceBufferDays = await maintenanceBufferForProduct(allocation.productId)
    const others = await prisma.allocation.findMany({
      where: {
        ...blockingAllocationsWhere([allocation.productId], maintenanceBufferDays, asOf),
        id: { not: allocation.id },
      },
    })
    if (
      isOccupiedForRange(others.map(toWindow), asOf, allocation.checkoutDate, { asOf, maintenanceBufferDays })
    ) {
      throw new AppError(
        ErrorCodes.EARLY_CHECKOUT_CONFLICT,
        409,
        'Another allocation holds this product between now and its checkout date',
      )
    }
  }
  const result = await prisma.allocation.updateMany({
    where: { id, status: 'reserved' },
    data: {
      status: 'checked_out',
      actualCheckoutDate: asOf,
      conditionNotesOut: data.conditionNotesOut,
      depositCollected: data.depositCollected,
    },
  })
  if (result.count === 0) {
    throw new AppError(
      ErrorCodes.INVALID_ALLOCATION_TRANSITION,
      409,
      'Allocation status changed concurrently; refresh and try again',
    )
  }
  return prisma.allocation.findUniqueOrThrow({ where: { id } })
}

export interface ReturnInput {
  conditionNotesIn?: string
  depositReturned?: number
  actualReturnDate?: Date
}

export async function returnAllocation(locationId: string, id: string, data: ReturnInput) {
  const allocation = await getAllocationOrThrow(locationId, id)
  if (allocation.status !== 'checked_out') {
    throw new AppError(
      ErrorCodes.INVALID_ALLOCATION_TRANSITION,
      409,
      `Cannot return an allocation with status ${allocation.status}`,
    )
  }
  const result = await prisma.allocation.updateMany({
    where: { id, status: 'checked_out' },
    data: {
      status: 'returned',
      actualReturnDate: data.actualReturnDate ?? new Date(),
      conditionNotesIn: data.conditionNotesIn,
      depositReturned: data.depositReturned,
    },
  })
  if (result.count === 0) {
    throw new AppError(
      ErrorCodes.INVALID_ALLOCATION_TRANSITION,
      409,
      'Allocation status changed concurrently; refresh and try again',
    )
  }
  return prisma.allocation.findUniqueOrThrow({ where: { id } })
}

export async function cancelAllocation(locationId: string, id: string) {
  const allocation = await getAllocationOrThrow(locationId, id)
  if (allocation.status !== 'reserved') {
    throw new AppError(
      ErrorCodes.INVALID_ALLOCATION_TRANSITION,
      409,
      `Cannot cancel an allocation with status ${allocation.status}`,
    )
  }
  const result = await prisma.allocation.updateMany({
    where: { id, status: 'reserved' },
    data: { status: 'cancelled' },
  })
  if (result.count === 0) {
    throw new AppError(
      ErrorCodes.INVALID_ALLOCATION_TRANSITION,
      409,
      'Allocation status changed concurrently; refresh and try again',
    )
  }
  return prisma.allocation.findUniqueOrThrow({ where: { id } })
}

// occupancyQuery.ts's helpers trust whatever productId they're handed with
// no location check of their own by design — these two functions are the
// callers responsible for verifying ownership first.
async function assertProductInLocation(locationId: string, productId: string): Promise<void> {
  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product || product.locationId !== locationId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${productId} not found`)
  }
}

export async function getProductAvailability(locationId: string, productId: string, asOf: Date = new Date()) {
  await assertProductInLocation(locationId, productId)
  const maintenanceBufferDays = await maintenanceBufferForProduct(productId)
  const windows = await loadBlockingWindows([productId], maintenanceBufferDays, asOf)
  return derivedAvailability(windows, asOf, { maintenanceBufferDays })
}

export async function isProductAvailableForRange(
  locationId: string,
  productId: string,
  checkoutDate: Date,
  dueDate: Date,
) {
  await assertProductInLocation(locationId, productId)
  const maintenanceBufferDays = await maintenanceBufferForProduct(productId)
  const windows = await loadBlockingWindows([productId], maintenanceBufferDays, checkoutDate)
  return !isOccupiedForRange(windows, checkoutDate, dueDate, { maintenanceBufferDays })
}

export async function listAllocations(locationId: string) {
  return prisma.allocation.findMany({
    where: { product: { locationId } },
    orderBy: { createdAt: 'desc' },
  })
}
```

- [ ] **Step 5: Update `routes/allocations.ts` to pass `req.staff!.locationId`**

```typescript
allocationsRouter.get('/', async (req, res) => {
  res.json(await listAllocations(req.staff!.locationId))
})

allocationsRouter.post('/:id/check-out', async (req, res) => {
  const parsed = checkOutSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid check-out payload')
  }
  res.json(await checkOutAllocation(req.staff!.locationId, req.params.id, parsed.data))
})

allocationsRouter.post('/:id/return', async (req, res) => {
  const parsed = returnSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid return payload')
  }
  res.json(await returnAllocation(req.staff!.locationId, req.params.id, parsed.data))
})

allocationsRouter.post('/:id/cancel', async (req, res) => {
  res.json(await cancelAllocation(req.staff!.locationId, req.params.id))
})

allocationsRouter.get('/products/:productId/availability', async (req, res) => {
  const rangeParsed = availabilityRangeSchema.safeParse(req.query)
  if (rangeParsed.success) {
    const available = await isProductAvailableForRange(
      req.staff!.locationId,
      req.params.productId,
      rangeParsed.data.checkoutDate,
      rangeParsed.data.dueDate,
    )
    res.json({ available })
    return
  }

  const asOfQuery = req.query.asOf
  const asOf = typeof asOfQuery === 'string' ? new Date(asOfQuery) : new Date()
  res.json({ status: await getProductAvailability(req.staff!.locationId, req.params.productId, asOf) })
})
```

- [ ] **Step 6: Run the tests**

```bash
cd server
npm test -- allocationService.test.ts allocations.test.ts
```
Expected: PASS (update `allocations.test.ts`'s existing HTTP-level tests the same way as prior tasks, plus a two-location fixture case per endpoint if not already covered by the service-level tests in Step 2).

- [ ] **Step 7: Commit**

```bash
git add server/src/services/allocationService.ts server/src/services/allocationService.test.ts server/src/routes/allocations.ts server/src/routes/allocations.test.ts
git commit -m "Scope Allocation through the Product relation, verify occupancyQuery callers"
```

---

## Task 15: Scope `Calendar` through the `Product` relation

**Design ref:** §5 (Calendar)

**Files:**
- Modify: `server/src/services/calendarService.ts`
- Modify: `server/src/routes/calendar.ts`
- Test: `server/src/services/calendarService.test.ts`
- Test: `server/src/routes/calendar.test.ts`

**Interfaces:**
- Consumes: `req.staff.locationId`.
- Produces: `listGoingOut(locationId, from, to)`, `listDueBack(locationId, from, to)`, `listOverdue(locationId, asOf?)`.

- [ ] **Step 1: Update `calendarService.test.ts` (red first)**

```typescript
  it('only returns going-out allocations for the given location', async () => {
    // seed one allocation under locationId, one under otherLocationId, both
    // status 'reserved' with checkoutDate inside the queried range
    ...
    const results = await listGoingOut(locationId, from, to)
    expect(results).toHaveLength(1)
  })
```

(Add equivalent cases for `listDueBack` and `listOverdue`.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- calendarService.test.ts` (from `server/`)
Expected: FAIL.

- [ ] **Step 3: Rewrite `calendarService.ts`**

```typescript
import { prisma } from '../db/client.js'

export function listGoingOut(locationId: string, from: Date, to: Date) {
  return prisma.allocation.findMany({
    where: {
      status: 'reserved',
      checkoutDate: { gte: from, lte: to },
      product: { locationId },
    },
    orderBy: { checkoutDate: 'asc' },
  })
}

export function listDueBack(locationId: string, from: Date, to: Date) {
  return prisma.allocation.findMany({
    where: {
      status: 'checked_out',
      dueDate: { gte: from, lte: to },
      product: { locationId },
    },
    orderBy: { dueDate: 'asc' },
  })
}

export function listOverdue(locationId: string, asOf: Date = new Date()) {
  return prisma.allocation.findMany({
    where: {
      status: 'checked_out',
      dueDate: { lt: asOf },
      product: { locationId },
    },
    orderBy: { dueDate: 'asc' },
  })
}
```

- [ ] **Step 4: Update `routes/calendar.ts`**

```typescript
calendarRouter.get('/going-out', async (req, res) => {
  const parsed = rangeSchema.safeParse(req.query)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'from and to query params are required')
  }
  res.json(await listGoingOut(req.staff!.locationId, parsed.data.from, parsed.data.to))
})

calendarRouter.get('/due-back', async (req, res) => {
  const parsed = rangeSchema.safeParse(req.query)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'from and to query params are required')
  }
  res.json(await listDueBack(req.staff!.locationId, parsed.data.from, parsed.data.to))
})

calendarRouter.get('/overdue', async (req, res) => {
  const asOfQuery = req.query.asOf
  const asOf = typeof asOfQuery === 'string' ? new Date(asOfQuery) : new Date()
  res.json(await listOverdue(req.staff!.locationId, asOf))
})
```

- [ ] **Step 5: Run the tests**

```bash
cd server
npm test -- calendarService.test.ts calendar.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/calendarService.ts server/src/services/calendarService.test.ts server/src/routes/calendar.ts server/src/routes/calendar.test.ts
git commit -m "Scope Calendar through the Product relation"
```

---

## Task 16: Add the Contract→Client location check

**Design ref:** §5 (Contract → Client)

**Files:**
- Modify: `server/src/services/contractService.ts`
- Test: `server/src/services/contractService.test.ts`

**Interfaces:**
- Consumes: `Client.locationId` (Task 4).
- Produces: `createContract` now 404s if `input.clientId` belongs to a different location than `input.locationId`, mirroring the existing product check.

- [ ] **Step 1: Read the existing product-location check in `createContract`**

```bash
grep -n "product.locationId !== input.locationId" -A5 -B10 server/src/services/contractService.ts
```

- [ ] **Step 2: Write a failing test**

In `server/src/services/contractService.test.ts`:

```typescript
  it('throws NOT_FOUND when the client belongs to a different location than the contract', async () => {
    const otherLocation = await prisma.location.create({ data: { name: 'Other', address: 'X' } })
    const clientElsewhere = await prisma.client.create({
      data: { locationId: otherLocation.id, name: 'C', phone: '1', email: 'c@x.com' },
    })

    await expect(
      createContract({
        locationId, // the fixture's own location
        clientId: clientElsewhere.id,
        staffId,
        eventDate: new Date(),
        paymentMethod: 'cash',
        items: [],
        installments: [],
      }),
    ).rejects.toThrow(AppError)
  })
```

(Match the exact `CreateContractInput` shape and existing fixture variable names already used elsewhere in this test file.)

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- contractService.test.ts` (from `server/`)
Expected: FAIL — today `clientId` isn't checked at all, so this either throws a different error (a later FK violation) or succeeds incorrectly.

- [ ] **Step 4: Add the check**

In `server/src/services/contractService.ts`, near the existing product ownership check inside `createContract`, add:

```typescript
  const client = await prisma.client.findUnique({ where: { id: input.clientId } })
  // Same treatment as the product check just above: a client from another
  // location is indistinguishable from a missing one, so this can't be used
  // to probe whether a given client ID exists somewhere outside the
  // caller's own location.
  if (!client || client.locationId !== input.locationId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Client ${input.clientId} not found`)
  }
```

Place this check before the transaction that creates the `Contract`/`Allocation` rows (alongside, not replacing, the existing product loop's ownership check).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- contractService.test.ts`
Expected: PASS, including all pre-existing tests in the file (unchanged behavior for same-location clients).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/contractService.ts server/src/services/contractService.test.ts
git commit -m "Add Contract->Client location check to createContract, mirroring the existing product check"
```

---

## Task 17: Fix the product-photo endpoint to check ownership

**Design ref:** §5 (Product photos)

**Files:**
- Modify: `server/src/routes/products.ts`
- Test: `server/src/routes/products.test.ts`

**Interfaces:**
- Consumes: `productService.getProduct(locationId, id)` from Task 13.

- [ ] **Step 1: Read the current photo-serving route**

```bash
grep -n "photos/:filename" -A20 server/src/routes/products.ts
```

- [ ] **Step 2: Write a failing test**

```typescript
  it('404s when requesting a photo through a productId that belongs to another location', async () => {
    const { staffA, productB } = await seedTwoLocations()
    const token = signStaffToken({ staffId: staffA.id, role: 'owner' })
    const photoBRow = await prisma.product.update({
      where: { id: productB.id },
      data: { photos: JSON.stringify(['abc-123.jpg']) },
    })

    const res = await request(app)
      .get(`/api/products/${photoBRow.id}/photos/abc-123.jpg`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })

  it('404s when the filename is not actually one of that product\'s own photos', async () => {
    const { staffA, productA } = await seedTwoLocations()
    const token = signStaffToken({ staffId: staffA.id, role: 'owner' })
    // productA has no photos recorded, even though the filename pattern is valid
    const res = await request(app)
      .get(`/api/products/${productA.id}/photos/00000000-0000-0000-0000-000000000000.jpg`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- products.test.ts` (from `server/`)
Expected: FAIL — today the route ignores `:id` entirely.

- [ ] **Step 4: Fix the route**

```typescript
productsRouter.get('/:id/photos/:filename', async (req, res) => {
  if (!PHOTO_FILENAME_PATTERN.test(req.params.filename)) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo not found')
  }
  const product = await getProduct(req.staff!.locationId, req.params.id)
  if (!product.photos.includes(req.params.filename)) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo not found')
  }

  const dir = process.env.PRODUCT_PHOTOS_DIR ?? './product-photos'
  const root = path.resolve(dir)
  const filePath = path.join(root, req.params.filename)
  if (!fs.existsSync(filePath)) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo not found')
  }
  res.set('Content-Type', 'image/jpeg')
  res.sendFile(req.params.filename, { root })
})
```

(`getProduct` already throws its own `NOT_FOUND` for a missing/cross-location `:id` — this just needs to be awaited before the filename check, and the ownership-of-this-specific-photo check added.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- products.test.ts`
Expected: PASS, including the existing legitimate-photo-fetch tests still passing.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/products.ts server/src/routes/products.test.ts
git commit -m "Check product ownership and photo membership before serving a product photo"
```

---

## Task 18: Fix relay resume's location handling

**Design ref:** §5 (Relay resume)

**Files:**
- Modify: `server/src/network/relayResume.ts`
- Modify: `server/src/server.ts` (call-site shape, if it changes)
- Test: `server/src/network/relayResume.test.ts`

**Interfaces:**
- Produces: `relayCredentialsFromEnv(): Promise<RelayCredentials | null>` — drops any location/Prisma awareness (pure env resolution). `resumeRelayConnections(credentials: RelayCredentials | null): Promise<RelayConnection[]>` — now checks each `ProductPhotoToken`'s own location's `connectivityMode` before resuming it, instead of trusting a single upstream gate.

- [ ] **Step 1: Read the current file and its two callers in `routes/products.ts`/`routes/contracts.ts` to confirm they already do their own mode check**

```bash
cat server/src/network/relayResume.ts
grep -n "connectivityMode" server/src/routes/products.ts server/src/routes/contracts.ts
```

- [ ] **Step 2: Write failing tests**

In `server/src/network/relayResume.test.ts` (check existing file structure first and match it):

```typescript
  it('resumes only the relay location\'s token, not the lan location\'s, on boot', async () => {
    const relayLocation = await prisma.location.create({ data: { name: 'Relay', address: 'R', connectivityMode: 'relay' } })
    const lanLocation = await prisma.location.create({ data: { name: 'Lan', address: 'L', connectivityMode: 'lan' } })
    const staffRelay = await prisma.staff.create({ data: { name: 'S1', login: `r-${Date.now()}`, passwordHash: 'x', role: 'owner', locationId: relayLocation.id } })
    const staffLan = await prisma.staff.create({ data: { name: 'S2', login: `l-${Date.now()}`, passwordHash: 'x', role: 'owner', locationId: lanLocation.id } })
    const relayToken = await prisma.productPhotoToken.create({
      data: { token: 'relay-token', staffId: staffRelay.id, locationId: relayLocation.id, expiresAt: new Date(Date.now() + 60_000) },
    })
    await prisma.productPhotoToken.create({
      data: { token: 'lan-token', staffId: staffLan.id, locationId: lanLocation.id, expiresAt: new Date(Date.now() + 60_000) },
    })

    const opened: string[] = []
    const connections = await resumeRelayConnections(
      { url: 'wss://example.com', productKey: 'k', installId: 'i' },
      { openRelayConnectionImpl: (token) => { opened.push(token); return fakeConnection() } },
    )
    expect(opened).toEqual(['relay-token'])
  })

  it('relayCredentialsFromEnv resolves env values with no Prisma/location awareness', async () => {
    process.env.GIROVEST_UPDATE_URL = 'wss://example.com'
    process.env.GIROVEST_UPDATE_KEY = 'k'
    process.env.GIROVEST_INSTALL_ID = 'i'
    const credentials = await relayCredentialsFromEnv()
    expect(credentials).toEqual({ url: 'wss://example.com', productKey: 'k', installId: 'i' })
  })
```

(Match the real exported shape of `openRelayConnection`/`registerRelayConnection` from `relayClient.ts`/`relayRegistry.ts` — check those files first and adjust the test's fake-injection approach to whatever seam already exists for testing `resumeRelayConnections`, e.g. it may already take an injectable `openRelayConnection` per existing tests in this file.)

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- relayResume.test.ts` (from `server/`)
Expected: FAIL.

- [ ] **Step 4: Rewrite `relayResume.ts`**

```typescript
import { prisma } from '../db/client.js'
import { openRelayConnection, type RelayConnection, type RelayCredentials } from './relayClient.js'
import { registerRelayConnection } from './relayRegistry.js'

export async function resumeRelayConnections(credentials: RelayCredentials | null): Promise<RelayConnection[]> {
  if (!credentials) return []
  const liveTokens = await prisma.productPhotoToken.findMany({
    where: { expiresAt: { gt: new Date() } },
    select: { token: true, expiresAt: true, location: { select: { connectivityMode: true } } },
  })
  return liveTokens
    .filter((row) => row.location.connectivityMode === 'relay')
    .map((row) => {
      const connection = openRelayConnection(row.token, credentials)
      registerRelayConnection(row.token, connection, row.expiresAt)
      return connection
    })
}

// Install-wide, location-independent: url/productKey/installId come only
// from env. No location/mode check here — the boot-time caller (server.ts)
// has no request context to derive one from, and request-context callers
// (routes/products.ts, routes/contracts.ts) already resolve and check their
// own location's connectivityMode before ever calling this.
export async function relayCredentialsFromEnv(): Promise<RelayCredentials | null> {
  const url = process.env.GIROVEST_UPDATE_URL
  const productKey = process.env.GIROVEST_UPDATE_KEY
  const installId = process.env.GIROVEST_INSTALL_ID
  if (!url || !productKey || !installId) return null
  return { url, productKey, installId }
}
```

- [ ] **Step 5: Confirm `server.ts`'s call site still works unchanged**

```bash
grep -n "relayCredentialsFromEnv\|resumeRelayConnections" server/src/server.ts
```

Expected: `await resumeRelayConnections(await relayCredentialsFromEnv())` — no change needed there, since both functions keep the same call signature from `server.ts`'s point of view.

- [ ] **Step 6: Run the tests**

Run: `npm test -- relayResume.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/network/relayResume.ts server/src/network/relayResume.test.ts
git commit -m "Fix relay resume: per-token connectivityMode check instead of one arbitrary boot-time location"
```

---

## Task 19: Defensive checks — `contractBackfill.ts` cross-location guard and `setupService` race hardening

**Design ref:** §5 caveat (`contractBackfill.ts`), §2 "Invariant enforcement" (non-blocking)

**Files:**
- Modify: `server/src/services/contractBackfill.ts`
- Modify: `server/src/services/setupService.ts`
- Test: `server/src/services/contractBackfill.test.ts`, `server/src/services/setupService.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `contractBackfill.ts` skips (and logs) an orphan whose product/client locations disagree instead of creating a cross-location `Contract`. `setupService.completeSetup` becomes race-safe against a double-submitted setup wizard.

- [ ] **Step 1: Read both files**

```bash
cat server/src/services/contractBackfill.ts server/src/services/setupService.ts
```

- [ ] **Step 2: Write a failing test for the backfill guard**

In `server/src/services/contractBackfill.test.ts`:

```typescript
  it('skips and does not create a Contract for an orphan whose client belongs to a different location than its product', async () => {
    const locationA = await prisma.location.create({ data: { name: 'A', address: 'A' } })
    const locationB = await prisma.location.create({ data: { name: 'B', address: 'B' } })
    const staff = await prisma.staff.create({ data: { name: 'S', login: `bf-${Date.now()}`, passwordHash: 'x', role: 'owner', locationId: locationA.id } })
    const product = await prisma.product.create({ data: { locationId: locationA.id, name: 'P', category: 'dress', size: 'M', color: 'red', rentalPrice: 10, depositAmount: 5 } })
    const client = await prisma.client.create({ data: { locationId: locationB.id, name: 'C', phone: '1', email: 'c@x.com' } })
    await prisma.allocation.create({
      data: { productId: product.id, clientId: client.id, staffId: staff.id, checkoutDate: new Date(), dueDate: new Date(), status: 'reserved', priceCharged: 100 },
    })

    await backfillOrphanedContracts()

    const contracts = await prisma.contract.findMany()
    expect(contracts).toHaveLength(0)
  })
```

(Match the real exported function name from `contractBackfill.ts` — confirm it in Step 1 rather than assuming `backfillOrphanedContracts`.)

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- contractBackfill.test.ts` (from `server/`)
Expected: FAIL — today it would create the cross-location `Contract` silently.

- [ ] **Step 4: Add the guard**

In `server/src/services/contractBackfill.ts`, inside the loop that builds a `Contract` from each orphaned allocation group, add before the create:

```typescript
    // Defensive check, not expected to trigger today (every allocation to
    // date shares its product's and client's location, since only one
    // Location has ever existed) — but once createContract enforces
    // client/product location agreement for new allocations, this becomes
    // the one remaining path that could ever disagree, and silently
    // creating a cross-location Contract would be worse than skipping it.
    if (orphan.product.locationId !== orphan.client.locationId) {
      console.warn(
        `contractBackfill: skipping orphaned allocation ${orphan.id} — ` +
          `product location (${orphan.product.locationId}) and client location ` +
          `(${orphan.client.locationId}) disagree`,
      )
      continue
    }
```

(Adjust variable names to match whatever the surrounding loop already calls its orphan/product/client references — confirmed in Step 1's read.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- contractBackfill.test.ts`
Expected: PASS, plus all pre-existing tests in the file still green (same-location orphans are unaffected).

- [ ] **Step 6: Write a failing test for the setup race**

In `server/src/services/setupService.test.ts`:

```typescript
  it('only one of two concurrent completeSetup calls succeeds', async () => {
    const input = {
      shopName: 'Shop', shopAddress: 'Addr', ownerName: 'Owner',
      ownerLogin: `race-${Date.now()}`, ownerPassword: 'password123',
    }
    const results = await Promise.allSettled([completeSetup(input), completeSetup({ ...input, ownerLogin: `${input.ownerLogin}-2` })])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    expect(fulfilled).toHaveLength(1)
    const locationCount = await prisma.location.count()
    expect(locationCount).toBe(1)
  })
```

- [ ] **Step 7: Run to verify it fails**

Run: `npm test -- setupService.test.ts` (from `server/`)
Expected: FAIL — both calls currently succeed and create two `Location` rows (SQLite serializes writes at the connection level, but the check-then-create is two separate statements with no atomicity between them, so a race is still possible depending on timing — if this test is flaky rather than reliably failing, that itself confirms the race exists and step 8 still applies).

- [ ] **Step 8: Wrap `completeSetup` in a transaction with a re-check**

In `server/src/services/setupService.ts`:

```typescript
export async function completeSetup(
  input: CompleteSetupInput,
): Promise<{ locationId: string; staffId: string }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.location.count()
    if (existing > 0) {
      throw new AppError(ErrorCodes.SETUP_ALREADY_COMPLETE, 409, 'Setup has already been completed')
    }

    const location = await tx.location.create({
      data: {
        name: input.shopName,
        address: input.shopAddress,
        connectivityMode: input.connectivityMode ?? 'lan',
        contractClauses: {
          create: DEFAULT_CONTRACT_CLAUSES.map((text, index) => ({ text, sortOrder: index })),
        },
      },
    })

    const staff = await tx.staff.create({
      data: {
        // ... keep the rest of the existing staff-creation fields unchanged,
        // using tx instead of prisma throughout this function
      },
    })

    return { locationId: location.id, staffId: staff.id }
  })
}
```

(Keep every other field/line in the function body exactly as it reads today — the only changes are wrapping the whole body in `prisma.$transaction(async (tx) => { ... })` and replacing every `prisma.` call inside it with `tx.`.)

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm test -- setupService.test.ts`
Expected: PASS, deterministically (not flaky) — SQLite's transaction-level locking now makes the second transaction see the first's committed `Location` row before it can create its own.

- [ ] **Step 10: Commit**

```bash
git add server/src/services/contractBackfill.ts server/src/services/contractBackfill.test.ts server/src/services/setupService.ts server/src/services/setupService.test.ts
git commit -m "Add contractBackfill cross-location defensive check and make completeSetup race-safe"
```

---

## Final Verification

After Task 19, run the full checks before considering this plan complete:

```bash
cd server
npm test
npm run lint:location-scoping
npx tsc -p tsconfig.json --noEmit
```

Expected: all tests pass, the ast-grep rule reports zero violations, and the TypeScript compiler reports zero errors. Then manually verify the packaged-app path per the design's testing requirements — apply the `add_client_location_id` migration through the real `migrationRunner.applyMigrations` (already covered by Task 4's tests) against a copy of realistic seed data one more time as a final sanity check before this ships.
