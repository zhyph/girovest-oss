import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { applyMigrations, databaseUrlToPath } from './migrationRunner.js'

let workDir: string
let migrationsDir: string
let dbPath: string

function writeMigration(name: string, sql: string) {
  const dir = path.join(migrationsDir, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'migration.sql'), sql)
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function rows(query: string): Record<string, unknown>[] {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.prepare(query).all() as Record<string, unknown>[]
  } finally {
    db.close()
  }
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-runner-'))
  migrationsDir = path.join(workDir, 'migrations')
  fs.mkdirSync(migrationsDir)
  dbPath = path.join(workDir, 'app.db')
})

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

describe('applyMigrations', () => {
  it('applies pending migrations in name order and records them like prisma migrate deploy', () => {
    writeMigration('20260101000000_init', 'CREATE TABLE "A" ("id" TEXT PRIMARY KEY);')
    writeMigration(
      '20260102000000_add_b',
      'CREATE TABLE "B" ("id" TEXT PRIMARY KEY, "aId" TEXT REFERENCES "A"("id"));',
    )

    const applied = applyMigrations({ databasePath: dbPath, migrationsDir })

    expect(applied).toEqual(['20260101000000_init', '20260102000000_add_b'])
    const recorded = rows(
      'SELECT * FROM "_prisma_migrations" ORDER BY "migration_name"',
    )
    expect(recorded).toHaveLength(2)
    expect(recorded[0]).toMatchObject({
      migration_name: '20260101000000_init',
      checksum: sha256('CREATE TABLE "A" ("id" TEXT PRIMARY KEY);'),
      applied_steps_count: 1,
      logs: null,
      rolled_back_at: null,
    })
    expect(recorded[0].finished_at).not.toBeNull()
    expect(recorded[0].id).toMatch(/^[0-9a-f-]{36}$/)
    // The migrations actually executed, not just got recorded.
    expect(rows('SELECT name FROM sqlite_master WHERE type = \'table\' AND name IN (\'A\', \'B\')')).toHaveLength(2)
  })

  it('is a no-op when every migration is already applied', () => {
    writeMigration('20260101000000_init', 'CREATE TABLE "A" ("id" TEXT PRIMARY KEY);')
    applyMigrations({ databasePath: dbPath, migrationsDir })

    const applied = applyMigrations({ databasePath: dbPath, migrationsDir })

    expect(applied).toEqual([])
    expect(rows('SELECT * FROM "_prisma_migrations"')).toHaveLength(1)
  })

  it('applies only migrations that are not yet recorded', () => {
    writeMigration('20260101000000_init', 'CREATE TABLE "A" ("id" TEXT PRIMARY KEY);')
    applyMigrations({ databasePath: dbPath, migrationsDir })
    writeMigration('20260102000000_add_b', 'CREATE TABLE "B" ("id" TEXT PRIMARY KEY);')

    const applied = applyMigrations({ databasePath: dbPath, migrationsDir })

    expect(applied).toEqual(['20260102000000_add_b'])
  })

  it('ignores stray files and directories without migration.sql (e.g. migration_lock.toml)', () => {
    writeMigration('20260101000000_init', 'CREATE TABLE "A" ("id" TEXT PRIMARY KEY);')
    fs.writeFileSync(path.join(migrationsDir, 'migration_lock.toml'), 'provider = "sqlite"')
    fs.mkdirSync(path.join(migrationsDir, 'not_a_migration'))

    const applied = applyMigrations({ databasePath: dbPath, migrationsDir })

    expect(applied).toEqual(['20260101000000_init'])
  })

  it('executes scripts with PRAGMA statements outside a wrapping transaction, like prisma', () => {
    // Prisma's table-redefinition migrations rely on PRAGMA foreign_keys=OFF,
    // which is a silent no-op inside a transaction. Redefining a table that is
    // the target of an FK only works if the pragma actually took effect.
    writeMigration(
      '20260101000000_init',
      `CREATE TABLE "Parent" ("id" TEXT PRIMARY KEY);
CREATE TABLE "Child" ("id" TEXT PRIMARY KEY, "parentId" TEXT NOT NULL, CONSTRAINT "fk" FOREIGN KEY ("parentId") REFERENCES "Parent" ("id"));`,
    )
    writeMigration(
      '20260102000000_redefine',
      `PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Parent" ("id" TEXT PRIMARY KEY, "name" TEXT);
INSERT INTO "new_Parent" ("id") SELECT "id" FROM "Parent";
DROP TABLE "Parent";
ALTER TABLE "new_Parent" RENAME TO "Parent";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;`,
    )

    const applied = applyMigrations({ databasePath: dbPath, migrationsDir })

    expect(applied).toHaveLength(2)
    expect(rows('SELECT name FROM pragma_table_info(\'Parent\')').map((r) => r.name)).toEqual([
      'id',
      'name',
    ])
  })

  it('warns but continues when an applied migration was edited after the fact, like prisma migrate deploy', () => {
    // Verified against the real CLI: `prisma migrate deploy` exits 0 for an
    // edited already-applied migration. Aborting here instead would brick
    // every existing install on any byte-level drift of shipped migration.sql
    // files (e.g. a CRLF/LF flip between build machines).
    writeMigration('20260101000000_init', 'CREATE TABLE "A" ("id" TEXT PRIMARY KEY);')
    applyMigrations({ databasePath: dbPath, migrationsDir })
    writeMigration('20260101000000_init', 'CREATE TABLE "A" ("id" INTEGER PRIMARY KEY);')
    writeMigration('20260102000000_add_b', 'CREATE TABLE "B" ("id" TEXT PRIMARY KEY);')
    const warnings: string[] = []

    const applied = applyMigrations({
      databasePath: dbPath,
      migrationsDir,
      onWarn: (message) => warnings.push(message),
    })

    // The edited migration is NOT re-run; pending ones still apply.
    expect(applied).toEqual(['20260102000000_add_b'])
    expect(warnings.join('\n')).toMatch(/20260101000000_init/)
    expect(rows('SELECT * FROM "_prisma_migrations"')).toHaveLength(2)
  })

  it('throws a self-diagnosing error when the migrations directory is missing', () => {
    fs.rmSync(migrationsDir, { recursive: true })

    expect(() => applyMigrations({ databasePath: dbPath, migrationsDir })).toThrow(
      /migrations directory/i,
    )
  })

  it('records a failed migration with its error and throws, and refuses to run again until resolved', () => {
    writeMigration('20260101000000_init', 'CREATE TABLE "A" ("id" TEXT PRIMARY KEY);')
    writeMigration('20260102000000_broken', 'CREATE TABLE "A" ("id" TEXT PRIMARY KEY);')

    expect(() => applyMigrations({ databasePath: dbPath, migrationsDir })).toThrow(
      /20260102000000_broken/,
    )

    const failed = rows(
      'SELECT * FROM "_prisma_migrations" WHERE "migration_name" = \'20260102000000_broken\'',
    )
    expect(failed).toHaveLength(1)
    expect(failed[0].finished_at).toBeNull()
    expect(String(failed[0].logs)).toMatch(/already exists/)

    // Same semantics as prisma migrate deploy: a failed, unresolved migration
    // blocks any further attempt instead of being silently retried.
    expect(() => applyMigrations({ databasePath: dbPath, migrationsDir })).toThrow(
      /failed.*20260102000000_broken/i,
    )
  })

  it('retries a migration whose failed attempt was rolled back', () => {
    writeMigration('20260101000000_init', 'CREATE TABLE "A" ("id" TEXT PRIMARY KEY);')
    writeMigration('20260102000000_broken', 'CREATE TABLE "A" ("id" TEXT PRIMARY KEY);')
    expect(() => applyMigrations({ databasePath: dbPath, migrationsDir })).toThrow()

    // Simulate `prisma migrate resolve --rolled-back` + a fixed migration file.
    const db = new Database(dbPath)
    db.prepare(
      'UPDATE "_prisma_migrations" SET "rolled_back_at" = 1 WHERE "migration_name" = ?',
    ).run('20260102000000_broken')
    db.close()
    writeMigration('20260102000000_broken', 'CREATE TABLE "B" ("id" TEXT PRIMARY KEY);')

    const applied = applyMigrations({ databasePath: dbPath, migrationsDir })

    expect(applied).toEqual(['20260102000000_broken'])
  })

  it('creates the parent directory for the database file when missing', () => {
    dbPath = path.join(workDir, 'nested', 'deeper', 'app.db')
    writeMigration('20260101000000_init', 'CREATE TABLE "A" ("id" TEXT PRIMARY KEY);')

    const applied = applyMigrations({ databasePath: dbPath, migrationsDir })

    expect(applied).toEqual(['20260101000000_init'])
  })

  it('matches the on-disk state prisma migrate deploy produces for this project\'s real migrations', () => {
    const realMigrations = path.join(import.meta.dirname, '..', '..', 'prisma', 'sqlite', 'migrations')

    const applied = applyMigrations({ databasePath: dbPath, migrationsDir: realMigrations })

    expect(applied.length).toBeGreaterThanOrEqual(8)
    expect(applied[0]).toBe('20260717112419_init')
    // Spot-check a checksum against one captured from a real
    // `prisma migrate deploy` run (see PR description).
    const init = rows(
      'SELECT "checksum" FROM "_prisma_migrations" WHERE "migration_name" = \'20260717112419_init\'',
    )
    expect(init[0].checksum).toBe(
      '3f79b51c1baa999da074f308fd5f42d3165c0be1a8247219e0bf9c84630d491d',
    )
    // The schema is actually usable afterwards.
    expect(rows('SELECT name FROM sqlite_master WHERE name = \'Staff\'')).toHaveLength(1)
  })
})

describe('databaseUrlToPath', () => {
  it('strips the file: prefix prisma-style URLs carry', () => {
    expect(databaseUrlToPath('file:/home/user/data/dev.db')).toBe('/home/user/data/dev.db')
  })

  it('returns plain paths unchanged', () => {
    expect(databaseUrlToPath('/home/user/data/dev.db')).toBe('/home/user/data/dev.db')
  })
})
