import fs from 'fs'
import path from 'path'

const DESTINATION_MARKER = 'backup-destination'
const LAST_BACKUP_MARKER = 'last-manual-backup-at'
const SNOOZE_MARKER = 'backup-reminder-snoozed-until'
const DESTINATION_IDENTITY_FILE = '.girovest-backup-destination'
const BACKUP_NAME_PATTERN = /^girovest-backup-(\d{4}-\d{2}-\d{2}-\d{6})\.zip$/
const PARTIAL_NAME_PATTERN = /^\.girovest-backup-\d{4}-\d{2}-\d{2}-\d{6}\.zip\.partial$/

export const MAX_EXTERNAL_BACKUPS = 5

function readTrimmedMarker(userDataPath: string, fileName: string): string | null {
  try {
    const value = fs.readFileSync(path.join(userDataPath, fileName), 'utf-8').trim()
    return value || null
  } catch {
    return null
  }
}

function writeMarker(userDataPath: string, fileName: string, value: string): void {
  fs.writeFileSync(path.join(userDataPath, fileName), value, 'utf-8')
}

export function readBackupDestination(userDataPath: string): string | null {
  return readTrimmedMarker(userDataPath, DESTINATION_MARKER)
}

export function writeBackupDestination(userDataPath: string, destination: string): void {
  writeMarker(userDataPath, DESTINATION_MARKER, destination)
}

export function readLastManualBackupAt(userDataPath: string): string | null {
  return readTrimmedMarker(userDataPath, LAST_BACKUP_MARKER)
}

export function writeLastManualBackupAt(userDataPath: string, isoTimestamp: string): void {
  writeMarker(userDataPath, LAST_BACKUP_MARKER, isoTimestamp)
}

export function readSnoozedUntil(userDataPath: string): string | null {
  return readTrimmedMarker(userDataPath, SNOOZE_MARKER)
}

export function writeSnoozedUntil(userDataPath: string, isoTimestamp: string): void {
  writeMarker(userDataPath, SNOOZE_MARKER, isoTimestamp)
}

export function clearSnoozedUntil(userDataPath: string): void {
  fs.rmSync(path.join(userDataPath, SNOOZE_MARKER), { force: true })
}

// Verifies a destination that was already claimed before (e.g. a remembered
// path being reused without re-prompting). Missing or mismatched identity
// file both mean "not this destination anymore" — never silently reclaims.
export function verifyDestination(destinationDir: string, installId: string): boolean {
  if (!fs.existsSync(destinationDir)) return false
  const identityPath = path.join(destinationDir, DESTINATION_IDENTITY_FILE)
  if (!fs.existsSync(identityPath)) return false
  return fs.readFileSync(identityPath, 'utf-8').trim() === installId
}

export type ClaimDestinationResult = 'claimed' | 'mismatch' | 'missing'

// Claims a destination the user just picked (e.g. via the folder dialog).
// Writes the identity file if absent. If one already exists and belongs to
// a different install, the result is 'mismatch' unless `force` is set — the
// disaster-recovery path (a shop restores onto a brand-new machine from a
// USB drive, then wants to back up to that same drive again) legitimately
// hits this every time, since the drive's identity file still names the
// old, now-gone install. `force` lets the caller re-claim it after the user
// explicitly confirms it's really their own drive, not a different device
// that happens to share the remembered path.
export function claimDestination(
  destinationDir: string,
  installId: string,
  force = false,
): ClaimDestinationResult {
  if (!fs.existsSync(destinationDir)) return 'missing'
  const identityPath = path.join(destinationDir, DESTINATION_IDENTITY_FILE)
  if (!fs.existsSync(identityPath)) {
    fs.writeFileSync(identityPath, installId, 'utf-8')
    return 'claimed'
  }
  const existing = fs.readFileSync(identityPath, 'utf-8').trim()
  if (existing === installId) return 'claimed'
  if (!force) return 'mismatch'
  fs.writeFileSync(identityPath, installId, 'utf-8')
  return 'claimed'
}

export function formatBackupTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

export function parseBackupTimestamp(fileName: string): string | null {
  const match = BACKUP_NAME_PATTERN.exec(fileName)
  return match ? match[1]! : null
}

// Only ever touches files matching girovest-backup-<timestamp>.zip — see the
// design doc's Retention section for why an unfiltered directory listing
// (like the internal pruneBackups in backup.ts) is unsafe against a
// user-chosen folder. Sorts by the timestamp encoded in the filename, not
// filesystem mtime, which is unreliable on FAT32 and under cloud-sync
// clients.
export function pruneExternalBackups(destinationDir: string, max: number = MAX_EXTERNAL_BACKUPS): void {
  const entries = fs
    .readdirSync(destinationDir)
    .map((name) => ({ name, timestamp: parseBackupTimestamp(name) }))
    .filter((entry): entry is { name: string; timestamp: string } => entry.timestamp !== null)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
  for (const entry of entries.slice(max)) {
    fs.rmSync(path.join(destinationDir, entry.name), { force: true })
  }
}

// Sweeps a `.partial` file left behind by a backup that crashed or failed
// mid-write, so it is never mistaken for — or counted toward the retention
// limit of — a real backup. Only touches files matching the app's exact
// staging-file pattern to avoid deleting unrelated user files in a
// user-chosen destination folder.
export function sweepStalePartialBackups(destinationDir: string): void {
  for (const name of fs.readdirSync(destinationDir)) {
    if (PARTIAL_NAME_PATTERN.test(name)) {
      fs.rmSync(path.join(destinationDir, name), { force: true })
    }
  }
}

export function getDirectorySizeBytes(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0
  let total = 0
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name)
    total += entry.isDirectory() ? getDirectorySizeBytes(entryPath) : fs.statSync(entryPath).size
  }
  return total
}

// Zero new marker file: install-id (client/electron/installId.ts) is
// written exactly once, at first launch, and survives in-place updates —
// its file's creation time is a serviceable stand-in for "how long has this
// installation existed." birthtime is unsupported on some filesystems and
// comes back as the epoch there; mtime is the next best proxy in that case
// (install-id is written once and never rewritten after, so its mtime is
// just as stable).
export function resolveInstallDate(userDataPath: string): string {
  try {
    const stats = fs.statSync(path.join(userDataPath, 'install-id'))
    const birthtimeValid = stats.birthtimeMs > 0
    return (birthtimeValid ? stats.birthtime : stats.mtime).toISOString()
  } catch {
    // No install-id file yet — shouldn't happen in practice (main.ts always
    // resolves it before anything that needs this), but degrade to "now"
    // rather than throw: the grace period simply starts today.
    return new Date().toISOString()
  }
}
