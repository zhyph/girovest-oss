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
    db.prepare(`INSERT INTO "Location" ("id", "name", "address") VALUES (?, ?, ?)`).run(
      id,
      `Shop ${i}`,
      `Address ${i}`,
    )
    locationIds.push(id)
  }
  // Clients pre-date the locationId column, so they're seeded without one —
  // exactly the shape the real live database is in before this migration.
  for (let i = 0; i < 25; i++) {
    db.prepare(`INSERT INTO "Client" ("id", "name", "phone", "email") VALUES (?, ?, ?, ?)`).run(
      `client-${i}`,
      `Client ${i}`,
      `555-000${i}`,
      `client${i}@example.com`,
    )
  }
  db.close()
}

// Rows that hang off Client. ClientIdentityDocument/ClientAddressLine are
// ON DELETE CASCADE; Allocation/Contract are ON DELETE RESTRICT. The table
// rebuild below does DROP TABLE "Client", so without PRAGMA foreign_keys=OFF
// the cascading children would be silently deleted and the restricting ones
// would abort the migration. This seeds both kinds so the PRAGMA is actually
// exercised rather than assumed.
function seedClientChildren(): void {
  const db = new Database(dbPath)
  db.prepare(
    `INSERT INTO "Staff" ("id", "name", "login", "passwordHash", "role", "locationId") VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('staff-0', 'Staff Zero', 'staff0', 'hash', 'admin', 'loc-0')
  for (let i = 0; i < 25; i++) {
    db.prepare(
      `INSERT INTO "ClientIdentityDocument" ("id", "clientId", "label", "value") VALUES (?, ?, ?, ?)`,
    ).run(`doc-${i}`, `client-${i}`, 'CPF', `000.000.000-${i}`)
    db.prepare(
      `INSERT INTO "ClientAddressLine" ("id", "clientId", "label", "value", "sortOrder") VALUES (?, ?, ?, ?, ?)`,
    ).run(`addr-${i}`, `client-${i}`, 'Rua', `Rua ${i}`, 0)
    db.prepare(
      `INSERT INTO "Contract" ("id", "number", "locationId", "clientId", "staffId", "eventDate", "paymentMethod") VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(`contract-${i}`, i + 1, 'loc-0', `client-${i}`, 'staff-0', '2026-09-01T00:00:00.000Z', 'pix')
  }
  db.close()
}

function applyClientLocationMigration(): void {
  const target = fs
    .readdirSync(REAL_MIGRATIONS_DIR)
    .find((name) => name.endsWith('_add_client_location_id'))!
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'staged-final-migration-'))
  fs.cpSync(path.join(REAL_MIGRATIONS_DIR, target), path.join(stageDir, target), {
    recursive: true,
  })
  applyMigrations({ databasePath: dbPath, migrationsDir: stageDir })
  fs.rmSync(stageDir, { recursive: true, force: true })
}

describe('add_client_location_id migration', () => {
  it('backfills every existing Client to the sole Location, on realistic non-empty data', () => {
    applyAllRealMigrationsExceptClientLocationId()
    seedRealisticData(1)
    applyClientLocationMigration()

    const db = new Database(dbPath, { readonly: true })
    const rows = db.prepare(`SELECT "id", "locationId" FROM "Client"`).all() as {
      locationId: string
    }[]
    db.close()
    expect(rows).toHaveLength(25)
    expect(rows.every((row) => row.locationId === 'loc-0')).toBe(true)
  })

  it('migrates a fresh, empty database (zero Location rows) without the guard firing', () => {
    applyAllRealMigrationsExceptClientLocationId()
    // No seed data at all — this is what every real first launch looks like.
    expect(() => applyClientLocationMigration()).not.toThrow()

    const db = new Database(dbPath, { readonly: true })
    const columns = db.prepare(`PRAGMA table_info("Client")`).all() as {
      name: string
      notnull: number
    }[]
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

  // Unreachable through any current production code path (nothing anywhere
  // deletes a Location), but guarded rather than assumed: without the widened
  // guard this shape passes the "> 1" check, backfills every locationId to
  // NULL, and then dies mid-rebuild on the NOT NULL constraint — a
  // half-migrated database that re-running cannot repair.
  it('aborts cleanly when Client rows exist with no Location row, leaving Client untouched', () => {
    applyAllRealMigrationsExceptClientLocationId()
    seedRealisticData(0)
    expect(() => applyClientLocationMigration()).toThrow(/Client rows exist with no Location row/)

    const db = new Database(dbPath, { readonly: true })
    const columns = db.prepare(`PRAGMA table_info("Client")`).all() as { name: string }[]
    const newClient = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='new_Client'`)
      .get()
    db.close()
    expect(columns.some((c) => c.name === 'locationId')).toBe(false)
    expect(newClient).toBeUndefined()
  })

  it('preserves rows that reference Client across the table rebuild', () => {
    applyAllRealMigrationsExceptClientLocationId()
    seedRealisticData(1)
    seedClientChildren()
    applyClientLocationMigration()

    const db = new Database(dbPath, { readonly: true })
    const counts = {
      documents: (
        db.prepare(`SELECT COUNT(*) AS n FROM "ClientIdentityDocument"`).get() as { n: number }
      ).n,
      addressLines: (
        db.prepare(`SELECT COUNT(*) AS n FROM "ClientAddressLine"`).get() as { n: number }
      ).n,
      contracts: (db.prepare(`SELECT COUNT(*) AS n FROM "Contract"`).get() as { n: number }).n,
    }
    const violations = db.prepare(`PRAGMA foreign_key_check`).all()
    db.close()

    expect(counts).toEqual({ documents: 25, addressLines: 25, contracts: 25 })
    // ...and the rebuilt table must not leave dangling references behind.
    expect(violations).toEqual([])
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
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='trigger' AND name='_location_scoping_guard_trigger'`,
      )
      .get()
    db.close()
    expect(scratchTable).toBeUndefined()
    expect(scratchTrigger).toBeUndefined()
  })
})
