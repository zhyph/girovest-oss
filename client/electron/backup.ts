import fs from 'fs'
import path from 'path'

export const MAX_BACKUPS = 5

const MARKER_FILENAME = 'db-backup-version'

// Deliberately its own marker file: server-runtime/.version (see
// ensureWritableServerRuntime in main.ts) is rewritten BEFORE migrations run,
// so keying the backup off it would never trigger one.
export function readBackupMarker(userDataPath: string): string | null {
  const markerPath = path.join(userDataPath, MARKER_FILENAME)
  return fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf-8') : null
}

export function writeBackupMarker(userDataPath: string, version: string): void {
  fs.writeFileSync(path.join(userDataPath, MARKER_FILENAME), version, 'utf-8')
}

// Copies dev.db plus any sidecars (-journal/-wal/-shm — a sidecar can survive
// a previous crash, and backing up dev.db alone in that state produces an
// inconsistent copy) into userData/backups/<oldVersion>/ before a new app
// version's migrations run. Returns the backup dir, or null when skipped.
//
// Keyed by <oldVersion> alone and overwritten on retry: a failed migration is
// transactional (DB untouched), so a crash-looping upgrade re-copies the same
// bytes. Keying by version+date would fill the retention quota with identical
// copies and evict the actually-distinct older-version backups.
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
  // True first install: nothing to back up. The caller still writes the
  // marker after migrations succeed.
  if (dbFiles.length === 0) return null

  // Legacy installs predate the marker; there is no version to key by, so
  // this is the one place a date suffix is used.
  const dirName = marker ?? `pre-updater-${today}`
  const backupsDir = path.join(userDataPath, 'backups')
  const destDir = path.join(backupsDir, dirName)
  fs.rmSync(destDir, { recursive: true, force: true })
  fs.mkdirSync(destDir, { recursive: true })
  for (const name of dbFiles) {
    fs.copyFileSync(path.join(userDataPath, name), path.join(destDir, name))
  }
  pruneBackups(backupsDir)
  return destDir
}

export function pruneBackups(backupsDir: string, max: number = MAX_BACKUPS): void {
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
