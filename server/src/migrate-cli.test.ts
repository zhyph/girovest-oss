import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { runMigrateCli } from './migrate-cli.js'

let serverCwd: string
let dataDir: string

beforeEach(() => {
  serverCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-cli-cwd-'))
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-cli-data-'))
  const migrationDir = path.join(serverCwd, 'prisma', 'sqlite', 'migrations', '20260101000000_init')
  fs.mkdirSync(migrationDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationDir, 'migration.sql'),
    'CREATE TABLE "A" ("id" TEXT PRIMARY KEY);',
  )
})

afterEach(() => {
  fs.rmSync(serverCwd, { recursive: true, force: true })
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('runMigrateCli', () => {
  it('applies the migrations under <cwd>/prisma/sqlite/migrations to the DATABASE_URL database', () => {
    const dbPath = path.join(dataDir, 'dev.db')

    const applied = runMigrateCli({ DATABASE_URL: `file:${dbPath}` }, serverCwd)

    expect(applied).toEqual(['20260101000000_init'])
    const db = new Database(dbPath, { readonly: true })
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE name IN ('A', '_prisma_migrations')")
      .all()
    db.close()
    expect(tables).toHaveLength(2)
  })

  it('throws when DATABASE_URL is missing', () => {
    expect(() => runMigrateCli({}, serverCwd)).toThrow(/DATABASE_URL/)
  })

  it('refuses to run against a non-sqlite provider', () => {
    expect(() =>
      runMigrateCli({ DB_PROVIDER: 'postgresql', DATABASE_URL: 'postgres://x' }, serverCwd),
    ).toThrow(/sqlite/i)
  })
})
