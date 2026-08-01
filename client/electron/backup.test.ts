import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  readBackupMarker,
  writeBackupMarker,
  backupDatabaseIfNeeded,
  pruneBackups,
} from './backup.ts'

describe('backup marker', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-marker-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns null when no marker exists', () => {
    expect(readBackupMarker(tmpDir)).toBeNull()
  })

  it('round-trips a written version', () => {
    writeBackupMarker(tmpDir, '0.2.0')
    expect(readBackupMarker(tmpDir)).toBe('0.2.0')
  })
})

describe('backupDatabaseIfNeeded', () => {
  let userData: string

  beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-db-test-'))
  })

  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true })
  })

  it('skips when the marker matches the current version', () => {
    fs.writeFileSync(path.join(userData, 'dev.db'), 'data')
    writeBackupMarker(userData, '0.3.0')
    expect(backupDatabaseIfNeeded(userData, '0.3.0', '2026-07-22')).toBeNull()
    expect(fs.existsSync(path.join(userData, 'backups'))).toBe(false)
  })

  it('skips on a true first install (no marker and no dev.db)', () => {
    expect(backupDatabaseIfNeeded(userData, '0.3.0', '2026-07-22')).toBeNull()
    expect(fs.existsSync(path.join(userData, 'backups'))).toBe(false)
  })

  it('copies dev.db and sidecar files into backups/<oldVersion>/', () => {
    fs.writeFileSync(path.join(userData, 'dev.db'), 'main')
    fs.writeFileSync(path.join(userData, 'dev.db-journal'), 'journal')
    fs.writeFileSync(path.join(userData, 'dev.db-wal'), 'wal')
    // Decoy that must NOT be copied: matches neither dev.db nor dev.db-*.
    fs.writeFileSync(path.join(userData, 'dev.db.old-manual-copy'), 'x')
    writeBackupMarker(userData, '0.2.0')

    const dest = backupDatabaseIfNeeded(userData, '0.3.0', '2026-07-22')

    expect(dest).toBe(path.join(userData, 'backups', '0.2.0'))
    expect(fs.readFileSync(path.join(dest!, 'dev.db'), 'utf-8')).toBe('main')
    expect(fs.readFileSync(path.join(dest!, 'dev.db-journal'), 'utf-8')).toBe('journal')
    expect(fs.readFileSync(path.join(dest!, 'dev.db-wal'), 'utf-8')).toBe('wal')
    expect(fs.existsSync(path.join(dest!, 'dev.db.old-manual-copy'))).toBe(false)
  })

  it('falls back to pre-updater-<date> when dev.db exists but no marker does', () => {
    fs.writeFileSync(path.join(userData, 'dev.db'), 'legacy')
    const dest = backupDatabaseIfNeeded(userData, '0.3.0', '2026-07-22')
    expect(dest).toBe(path.join(userData, 'backups', 'pre-updater-2026-07-22'))
    expect(fs.readFileSync(path.join(dest!, 'dev.db'), 'utf-8')).toBe('legacy')
  })

  it('overwrites an existing same-version backup dir (idempotent crash-loop retry)', () => {
    fs.writeFileSync(path.join(userData, 'dev.db'), 'current')
    writeBackupMarker(userData, '0.2.0')
    const staleDir = path.join(userData, 'backups', '0.2.0')
    fs.mkdirSync(staleDir, { recursive: true })
    fs.writeFileSync(path.join(staleDir, 'dev.db'), 'stale')
    fs.writeFileSync(path.join(staleDir, 'dev.db-wal'), 'stale-wal-not-in-source')

    backupDatabaseIfNeeded(userData, '0.3.0', '2026-07-22')

    expect(fs.readFileSync(path.join(staleDir, 'dev.db'), 'utf-8')).toBe('current')
    // Full overwrite, not merge: files absent from the source must be gone.
    expect(fs.existsSync(path.join(staleDir, 'dev.db-wal'))).toBe(false)
  })
})

describe('backupDatabaseIfNeeded completion safety', () => {
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
    fs.mkdirSync(path.join(backupsDir, 'pre-updater-2026-08-01'), { recursive: true })
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

describe('pruneBackups', () => {
  let backupsDir: string

  beforeEach(() => {
    backupsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-prune-test-'))
  })

  afterEach(() => {
    fs.rmSync(backupsDir, { recursive: true, force: true })
  })

  it('keeps the 5 most recently modified dirs and removes older ones', () => {
    for (let i = 0; i < 7; i++) {
      const dir = path.join(backupsDir, `0.${i}.0`)
      fs.mkdirSync(dir)
      // Distinct mtimes, oldest first: 0.0.0 is oldest, 0.6.0 newest.
      const t = new Date(2026, 0, 1 + i)
      fs.utimesSync(dir, t, t)
    }

    pruneBackups(backupsDir)

    const remaining = fs.readdirSync(backupsDir).sort()
    expect(remaining).toEqual(['0.2.0', '0.3.0', '0.4.0', '0.5.0', '0.6.0'])
  })

  it('leaves everything alone when at or under the limit', () => {
    fs.mkdirSync(path.join(backupsDir, '0.1.0'))
    pruneBackups(backupsDir)
    expect(fs.readdirSync(backupsDir)).toEqual(['0.1.0'])
  })
})
