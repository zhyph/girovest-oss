import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'

// A dependency-free replacement for `prisma migrate deploy`, so the packaged
// Electron app doesn't have to ship the Prisma CLI and its engines (~250MB,
// thousands of files — the bulk of what made the Windows installer slow).
// SQLite only: the packaged app always runs DB_PROVIDER=sqlite; dev and
// Postgres deployments keep using the real CLI.
//
// Compatibility with the real thing is deliberate and tested:
// - Same `_prisma_migrations` table DDL, so a database previously migrated by
//   the CLI (every existing install) is picked up seamlessly, and `prisma
//   migrate` keeps working against the same file in dev.
// - Same checksum (sha256 hex of migration.sql) and row shape.
// - Same tolerance and refusal semantics, both verified against the real CLI:
//   an edited already-applied migration (checksum mismatch) warns and
//   continues (`migrate deploy` exits 0 there — aborting instead would brick
//   every installed app on any byte drift of shipped .sql files, e.g. a
//   CRLF/LF flip between build machines; see .gitattributes), while a
//   failed-and-unresolved migration aborts instead of guessing.
// - Scripts run via exec() with NO wrapping transaction, matching Prisma on
//   SQLite: its RedefineTables migrations rely on `PRAGMA foreign_keys=OFF`,
//   which is a silent no-op inside a transaction.

const MIGRATIONS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`

interface MigrationRow {
  migration_name: string
  checksum: string
  finished_at: unknown
  rolled_back_at: unknown
}

export function databaseUrlToPath(url: string): string {
  return url.startsWith('file:') ? url.slice('file:'.length) : url
}

function listMigrations(migrationsDir: string): { name: string; script: string }[] {
  if (!fs.existsSync(migrationsDir)) {
    // Distinguish a packaging bug (extraResources not shipping the .sql
    // files) from a generic ENOENT the startup dialog can't act on.
    throw new Error(`Migrations directory not found: ${migrationsDir}`)
  }
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .flatMap((name) => {
      const scriptPath = path.join(migrationsDir, name, 'migration.sql')
      if (!fs.existsSync(scriptPath)) return []
      return [{ name, script: fs.readFileSync(scriptPath, 'utf-8') }]
    })
}

export function applyMigrations(options: {
  databasePath: string
  migrationsDir: string
  onWarn?: (message: string) => void
}): string[] {
  const { databasePath, migrationsDir, onWarn = console.warn } = options
  const migrations = listMigrations(migrationsDir)

  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const db = new Database(databasePath)
  try {
    db.exec(MIGRATIONS_TABLE_DDL)

    const rows = db
      .prepare('SELECT "migration_name", "checksum", "finished_at", "rolled_back_at" FROM "_prisma_migrations"')
      .all() as MigrationRow[]

    // Mirrors prisma migrate deploy: a migration that started but neither
    // finished nor was explicitly rolled back means the database is in an
    // unknown state — refuse to touch it until a human resolves it.
    const failed = rows.find((row) => row.finished_at == null && row.rolled_back_at == null)
    if (failed) {
      throw new Error(
        `A migration previously failed and was never resolved: "${failed.migration_name}". ` +
          'Resolve it (e.g. restore the pre-migration backup or run `prisma migrate resolve`) before retrying.',
      )
    }

    // Rolled-back rows don't count as applied — like prisma, the migration is
    // eligible to run again after `migrate resolve --rolled-back`.
    const applied = new Map(
      rows
        .filter((row) => row.finished_at != null && row.rolled_back_at == null)
        .map((row) => [row.migration_name, row.checksum]),
    )

    const insertStarted = db.prepare(
      'INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "started_at") VALUES (?, ?, ?, ?)',
    )
    const markFinished = db.prepare(
      'UPDATE "_prisma_migrations" SET "finished_at" = ?, "applied_steps_count" = 1 WHERE "id" = ?',
    )
    const recordFailure = db.prepare('UPDATE "_prisma_migrations" SET "logs" = ? WHERE "id" = ?')

    const newlyApplied: string[] = []
    for (const migration of migrations) {
      const checksum = createHash('sha256').update(migration.script).digest('hex')
      const appliedChecksum = applied.get(migration.name)
      if (appliedChecksum !== undefined) {
        if (appliedChecksum !== checksum) {
          onWarn(
            `Migration "${migration.name}" has been modified since it was applied ` +
              '(checksum mismatch); leaving the recorded version as-is.',
          )
        }
        continue
      }

      const id = randomUUID()
      insertStarted.run(id, checksum, migration.name, Date.now())
      try {
        db.exec(migration.script)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        recordFailure.run(message, id)
        throw new Error(`Migration "${migration.name}" failed: ${message}`)
      }
      markFinished.run(Date.now(), id)
      newlyApplied.push(migration.name)
    }
    return newlyApplied
  } finally {
    db.close()
  }
}
