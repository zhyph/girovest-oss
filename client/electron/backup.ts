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
