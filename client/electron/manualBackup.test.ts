import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  readBackupDestination,
  writeBackupDestination,
  readLastManualBackupAt,
  writeLastManualBackupAt,
  readSnoozedUntil,
  writeSnoozedUntil,
  clearSnoozedUntil,
  verifyDestination,
  claimDestination,
  formatBackupTimestamp,
  parseBackupTimestamp,
  pruneExternalBackups,
  sweepStalePartialBackups,
  getDirectorySizeBytes,
  resolveInstallDate,
  MAX_EXTERNAL_BACKUPS,
} from './manualBackup.ts'

describe('markers', () => {
  let userData: string

  beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-backup-test-'))
  })

  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true })
  })

  it('round-trips the destination marker, trimmed on read', () => {
    fs.writeFileSync(path.join(userData, 'backup-destination'), '/mnt/usb\n', 'utf-8')
    expect(readBackupDestination(userData)).toBe('/mnt/usb')
    writeBackupDestination(userData, '/mnt/other')
    expect(readBackupDestination(userData)).toBe('/mnt/other')
  })

  it('returns null for markers that were never written', () => {
    expect(readBackupDestination(userData)).toBeNull()
    expect(readLastManualBackupAt(userData)).toBeNull()
    expect(readSnoozedUntil(userData)).toBeNull()
  })

  it('round-trips last-backup and snooze markers, and clears the snooze marker', () => {
    writeLastManualBackupAt(userData, '2026-07-01T00:00:00.000Z')
    expect(readLastManualBackupAt(userData)).toBe('2026-07-01T00:00:00.000Z')
    writeSnoozedUntil(userData, '2026-08-01T00:00:00.000Z')
    expect(readSnoozedUntil(userData)).toBe('2026-08-01T00:00:00.000Z')
    clearSnoozedUntil(userData)
    expect(readSnoozedUntil(userData)).toBeNull()
  })
})

describe('claimDestination', () => {
  let destinationDir: string

  beforeEach(() => {
    destinationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-dest-test-'))
  })

  afterEach(() => {
    fs.rmSync(destinationDir, { recursive: true, force: true })
  })

  it('claims a fresh folder on first use', () => {
    expect(claimDestination(destinationDir, 'install-a')).toBe('claimed')
    expect(fs.readFileSync(path.join(destinationDir, '.girovest-backup-destination'), 'utf-8')).toBe(
      'install-a',
    )
  })

  it('reports "missing" for a folder that does not exist', () => {
    expect(claimDestination(path.join(destinationDir, 'missing'), 'install-a')).toBe('missing')
  })

  it('claims a folder already owned by this same install (idempotent)', () => {
    claimDestination(destinationDir, 'install-a')
    expect(claimDestination(destinationDir, 'install-a')).toBe('claimed')
  })

  it('reports "mismatch" for a folder claimed by a different install, without force', () => {
    claimDestination(destinationDir, 'install-a')
    expect(claimDestination(destinationDir, 'install-b')).toBe('mismatch')
    // Unchanged: a rejected claim must not overwrite the existing identity.
    expect(fs.readFileSync(path.join(destinationDir, '.girovest-backup-destination'), 'utf-8')).toBe(
      'install-a',
    )
  })

  it('takes over a folder claimed by a different install when force is true', () => {
    claimDestination(destinationDir, 'install-a')
    expect(claimDestination(destinationDir, 'install-b', true)).toBe('claimed')
    expect(fs.readFileSync(path.join(destinationDir, '.girovest-backup-destination'), 'utf-8')).toBe(
      'install-b',
    )
  })
})

describe('verifyDestination', () => {
  let destinationDir: string

  beforeEach(() => {
    destinationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-dest-test-'))
  })

  afterEach(() => {
    fs.rmSync(destinationDir, { recursive: true, force: true })
  })

  it('verifies a folder already claimed by this install', () => {
    claimDestination(destinationDir, 'install-a')
    expect(verifyDestination(destinationDir, 'install-a')).toBe(true)
  })

  it('rejects a folder claimed by a different install id', () => {
    claimDestination(destinationDir, 'install-a')
    expect(verifyDestination(destinationDir, 'install-b')).toBe(false)
  })

  it('rejects a folder that does not exist', () => {
    expect(verifyDestination(path.join(destinationDir, 'missing'), 'install-a')).toBe(false)
  })

  it('rejects a folder with no identity file yet', () => {
    expect(verifyDestination(destinationDir, 'install-a')).toBe(false)
  })
})

describe('backup filename timestamps', () => {
  it('formats and parses the same way', () => {
    const date = new Date(2026, 6, 31, 9, 5, 3)
    const formatted = formatBackupTimestamp(date)
    expect(formatted).toBe('2026-07-31-090503')
    expect(parseBackupTimestamp(`girovest-backup-${formatted}.zip`)).toBe(formatted)
  })

  it('returns null for a name that does not match the pattern', () => {
    expect(parseBackupTimestamp('random-file.zip')).toBeNull()
    expect(parseBackupTimestamp('vacation-photos')).toBeNull()
  })
})

describe('pruneExternalBackups', () => {
  let destinationDir: string

  beforeEach(() => {
    destinationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-prune-test-'))
  })

  afterEach(() => {
    fs.rmSync(destinationDir, { recursive: true, force: true })
  })

  it('keeps the 5 newest-by-name backups and deletes older ones', () => {
    for (let i = 0; i < 7; i++) {
      fs.writeFileSync(path.join(destinationDir, `girovest-backup-2026-07-0${i}-000000.zip`), 'x')
    }
    pruneExternalBackups(destinationDir)
    const remaining = fs.readdirSync(destinationDir).sort()
    expect(remaining).toEqual([
      'girovest-backup-2026-07-02-000000.zip',
      'girovest-backup-2026-07-03-000000.zip',
      'girovest-backup-2026-07-04-000000.zip',
      'girovest-backup-2026-07-05-000000.zip',
      'girovest-backup-2026-07-06-000000.zip',
    ])
  })

  it('never touches files that do not match the backup naming pattern', () => {
    for (let i = 0; i < MAX_EXTERNAL_BACKUPS + 2; i++) {
      fs.writeFileSync(path.join(destinationDir, `girovest-backup-2026-07-0${i}-000000.zip`), 'x')
    }
    fs.writeFileSync(path.join(destinationDir, 'vacation-photos.zip'), 'x')
    fs.mkdirSync(path.join(destinationDir, 'unrelated-folder'))
    pruneExternalBackups(destinationDir)
    expect(fs.existsSync(path.join(destinationDir, 'vacation-photos.zip'))).toBe(true)
    expect(fs.existsSync(path.join(destinationDir, 'unrelated-folder'))).toBe(true)
  })
})

describe('sweepStalePartialBackups', () => {
  it('removes .partial files and leaves completed backups alone', () => {
    const destinationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-sweep-test-'))
    fs.writeFileSync(path.join(destinationDir, '.girovest-backup-2026-07-31-000000.zip.partial'), 'x')
    fs.writeFileSync(path.join(destinationDir, 'girovest-backup-2026-07-30-000000.zip'), 'x')
    sweepStalePartialBackups(destinationDir)
    const remaining = fs.readdirSync(destinationDir)
    expect(remaining).toEqual(['girovest-backup-2026-07-30-000000.zip'])
    fs.rmSync(destinationDir, { recursive: true, force: true })
  })

  it('does not delete unrelated .zip.partial files', () => {
    const destinationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-sweep-test-'))
    fs.writeFileSync(path.join(destinationDir, '.girovest-backup-2026-07-31-000000.zip.partial'), 'x')
    fs.writeFileSync(path.join(destinationDir, 'my-download.zip.partial'), 'x')
    sweepStalePartialBackups(destinationDir)
    const remaining = fs.readdirSync(destinationDir).sort()
    expect(remaining).toEqual(['my-download.zip.partial'])
    fs.rmSync(destinationDir, { recursive: true, force: true })
  })
})

describe('getDirectorySizeBytes', () => {
  it('sums file sizes recursively', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dir-size-test-'))
    fs.writeFileSync(path.join(dir, 'a.txt'), 'abc')
    fs.mkdirSync(path.join(dir, 'sub'))
    fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), 'de')
    expect(getDirectorySizeBytes(dir)).toBe(5)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns 0 for a directory that does not exist', () => {
    expect(getDirectorySizeBytes('/does/not/exist')).toBe(0)
  })
})

describe('resolveInstallDate', () => {
  let userData: string

  beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'install-date-test-'))
  })

  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('returns install-id file birthtime as an ISO string', () => {
    fs.writeFileSync(path.join(userData, 'install-id'), 'some-id', 'utf-8')
    const result = resolveInstallDate(userData)
    expect(new Date(result).toString()).not.toBe('Invalid Date')
  })

  it('falls back to mtime when birthtime is unsupported (epoch 0)', () => {
    fs.writeFileSync(path.join(userData, 'install-id'), 'some-id', 'utf-8')
    const installIdPath = path.join(userData, 'install-id')
    const realStat = fs.statSync(installIdPath)
    const realStatSync = fs.statSync.bind(fs)
    vi.spyOn(fs, 'statSync').mockImplementation((p, ...args) => {
      if (p === installIdPath) {
        return { ...realStat, mtime: new Date(realStat.mtime.getTime()), birthtimeMs: 0, birthtime: new Date(0) } as fs.Stats
      }
      return realStatSync(p, ...args)
    })
    expect(resolveInstallDate(userData)).toBe(realStat.mtime.toISOString())
  })

  it('degrades to "now" when install-id does not exist yet', () => {
    const result = resolveInstallDate(userData)
    expect(new Date(result).toString()).not.toBe('Invalid Date')
  })
})
