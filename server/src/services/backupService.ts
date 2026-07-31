import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { databaseUrlToPath } from '../db/migrationRunner.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

// The server owns the live better-sqlite3 connection Prisma's
// @prisma/adapter-better-sqlite3 wraps; only it can safely snapshot a
// database that may be mid-write. better-sqlite3's online backup API
// (db.backup()) is safe to run against a database that is actively in use
// and restarts the transfer if a concurrent write lands mid-copy, unlike a
// raw filesystem copy of dev.db (+ its -wal sidecar) — see the design doc's
// "Data consistency" section.
//
// Staged next to dev.db itself, inside the same userData directory, so the
// Electron main process — which already knows userData's path — can find
// it by a fixed relative convention with no extra data in the response.
export async function createDatabaseSnapshot(): Promise<string> {
  // This whole mechanism is SQLite-only — the online-backup API used below
  // belongs to better-sqlite3, and the feature it serves (a shop backing up
  // its own local file to a USB drive) only applies to the Electron build.
  // Matches the exact condition server/src/db/client.ts already uses to
  // pick an adapter: DB_PROVIDER defaults to sqlite when unset, only an
  // explicit 'postgresql' switches away from it.
  if (process.env.DB_PROVIDER === 'postgresql') {
    throw new AppError(
      ErrorCodes.NOT_FOUND,
      404,
      'Manual backup snapshots are only available for SQLite deployments',
    )
  }
  const sourcePath = path.resolve(databaseUrlToPath(process.env.DATABASE_URL ?? 'file:./dev.db'))
  const stagingDir = path.join(path.dirname(sourcePath), 'backup-staging')
  fs.mkdirSync(stagingDir, { recursive: true })
  const destPath = path.join(stagingDir, 'dev.db')

  const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
  try {
    await source.backup(destPath)
  } finally {
    source.close()
  }
  return destPath
}
