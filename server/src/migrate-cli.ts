import path from 'path'
import { pathToFileURL } from 'url'
import { applyMigrations, databaseUrlToPath } from './db/migrationRunner.js'

// Entry point the Electron main process spawns (instead of the Prisma CLI)
// to bring the SQLite database up to date before starting the server — see
// the rationale in db/migrationRunner.ts. Bundled to dist-bundle/migrate.mjs
// for packaged builds; dev runs the tsc output directly.
export function runMigrateCli(env: NodeJS.ProcessEnv, cwd: string): string[] {
  if (env.DB_PROVIDER && env.DB_PROVIDER !== 'sqlite') {
    throw new Error(
      `This migration runner only supports sqlite (DB_PROVIDER=${env.DB_PROVIDER}); ` +
        'use `prisma migrate deploy` for other providers.',
    )
  }
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set')
  }
  // Assumes an absolute path inside the file: URL (Electron always builds one
  // from userData). A relative URL would resolve against cwd here, whereas
  // the Prisma CLI resolves it against the config file location.
  return applyMigrations({
    databasePath: path.resolve(cwd, databaseUrlToPath(env.DATABASE_URL)),
    migrationsDir: path.resolve(cwd, 'prisma', 'sqlite', 'migrations'),
  })
}

// Only run when executed directly (dist/migrate-cli.js or the bundled
// migrate.mjs), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const applied = runMigrateCli(process.env, process.cwd())
    console.log(
      applied.length === 0
        ? 'Database is up to date.'
        : `Applied ${applied.length} migration(s): ${applied.join(', ')}`,
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
