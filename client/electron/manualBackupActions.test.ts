import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { runManualBackup, runManualRestore, DESTINATION_CLAIMED_BY_ANOTHER_INSTALL } from './manualBackupActions.ts'
import {
  readBackupDestination,
  readLastManualBackupAt,
  writeSnoozedUntil,
  claimDestination,
  verifyDestination,
} from './manualBackup.ts'

// SQLite's on-disk magic header for use in tests
const SQLITE_HEADER = 'SQLite format 3\0'

/**
 * A structurally complete SQLite file: right magic, a legal page size, and a
 * header page count that agrees with the file's actual length.
 *
 * The fixtures used to be the magic bytes with a marker glued on, which is
 * exactly the shape of the truncated archive the restore is supposed to
 * REFUSE — so they could not tell a good database from a destroyed one.
 * `marker` is carried in the page body so a test can still prove which file
 * ended up where.
 */
function sqliteFile(marker: string): Buffer {
  const pageSize = 512
  const pageCount = 2
  const buffer = Buffer.alloc(pageSize * pageCount)
  buffer.write(SQLITE_HEADER, 0, 'latin1')
  buffer.writeUInt16BE(pageSize, 16)
  buffer.writeUInt32BE(7, 24) // change counter
  buffer.writeUInt32BE(pageCount, 28) // size in pages
  buffer.writeUInt32BE(7, 92) // version-valid-for, must equal the change counter
  buffer.write(marker, 100, 'latin1')
  return buffer
}

function markerOf(filePath: string): string {
  const contents = fs.readFileSync(filePath)
  return contents.subarray(100, contents.indexOf(0, 100)).toString('latin1')
}

describe('runManualBackup', () => {
  let userDataPath: string
  let destinationDir: string
  let stagingDbPath: string
  let productPhotosDir: string

  beforeEach(() => {
    userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-userdata-'))
    destinationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-dest-'))
    stagingDbPath = path.join(userDataPath, 'backup-staging', 'dev.db')
    fs.mkdirSync(path.dirname(stagingDbPath), { recursive: true })
    fs.writeFileSync(stagingDbPath, 'db-bytes')
    productPhotosDir = path.join(userDataPath, 'product-photos')
    fs.mkdirSync(productPhotosDir, { recursive: true })
    fs.writeFileSync(path.join(productPhotosDir, 'photo.jpg'), 'jpg-bytes')
  })

  afterEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true })
    fs.rmSync(destinationDir, { recursive: true, force: true })
  })

  function baseDeps(overrides: Partial<Parameters<typeof runManualBackup>[0]> = {}) {
    return {
      userDataPath,
      installId: 'install-a',
      stagingDbPath,
      productPhotosDir,
      now: new Date(2026, 6, 31, 9, 5, 3),
      pickDestinationFolder: async () => destinationDir,
      createArchive: async (
        sources: { path: string; kind: 'file' | 'folder'; zipFolder: string }[],
        destZipPath: string,
      ) => {
        fs.writeFileSync(destZipPath, `archive-of-${sources.length}-sources`)
      },
      estimateSourceBytes: () => 10,
      estimateFreeBytes: () => Number.MAX_SAFE_INTEGER,
      ...overrides,
    }
  }

  it('picks a destination on first use, writes the archive under the final name, and updates markers', async () => {
    const result = await runManualBackup(baseDeps(), false)
    expect(result.destination).toBe(destinationDir)
    expect(fs.existsSync(result.archivePath)).toBe(true)
    expect(path.basename(result.archivePath)).toBe('girovest-backup-2026-07-31-090503.zip')
    expect(readBackupDestination(userDataPath)).toBe(destinationDir)
    expect(readLastManualBackupAt(userDataPath)).toBe(new Date(2026, 6, 31, 9, 5, 3).toISOString())
  })

  it('reuses a remembered, verified destination without prompting again', async () => {
    await runManualBackup(baseDeps(), false)
    // Each run consumes (and deletes) the staged snapshot, so a second run
    // needs a fresh one — exactly what the renderer does by calling
    // POST /api/backup/snapshot before every attempt.
    fs.mkdirSync(path.dirname(stagingDbPath), { recursive: true })
    fs.writeFileSync(stagingDbPath, 'db-bytes')
    let pickerCalled = false
    await runManualBackup(
      baseDeps({
        now: new Date(2026, 7, 1, 0, 0, 0),
        pickDestinationFolder: async () => {
          pickerCalled = true
          return destinationDir
        },
      }),
      false,
    )
    expect(pickerCalled).toBe(false)
  })

  it('falls back to the picker when the remembered destination is unreachable', async () => {
    const goneDir = path.join(destinationDir, 'gone')
    fs.writeFileSync(path.join(userDataPath, 'backup-destination'), goneDir, 'utf-8')
    let pickerCalled = false
    await runManualBackup(
      baseDeps({
        pickDestinationFolder: async () => {
          pickerCalled = true
          return destinationDir
        },
      }),
      false,
    )
    expect(pickerCalled).toBe(true)
  })

  it('sweeps a stale .partial file from a previous crashed run before writing', async () => {
    fs.writeFileSync(path.join(destinationDir, '.girovest-backup-2020-01-01-000000.zip.partial'), 'stale')
    await runManualBackup(baseDeps(), false)
    expect(fs.existsSync(path.join(destinationDir, '.girovest-backup-2020-01-01-000000.zip.partial'))).toBe(
      false,
    )
  })

  it('clears an existing snooze marker after a successful backup', async () => {
    writeSnoozedUntil(userDataPath, '2099-01-01T00:00:00.000Z')
    await runManualBackup(baseDeps(), false)
    expect(fs.existsSync(path.join(userDataPath, 'backup-reminder-snoozed-until'))).toBe(false)
  })

  it('refuses to start when the destination does not have enough free space', async () => {
    await expect(
      runManualBackup(baseDeps({ estimateFreeBytes: () => 1, estimateSourceBytes: () => 1_000_000 }), false),
    ).rejects.toThrow(/space/i)
  })

  it('refuses to start when no database snapshot was staged', async () => {
    fs.rmSync(stagingDbPath, { force: true })
    await expect(runManualBackup(baseDeps(), false)).rejects.toThrow(/snapshot/i)
  })

  it('cleans up the staging directory after a successful backup', async () => {
    await runManualBackup(baseDeps(), false)
    expect(fs.existsSync(path.dirname(stagingDbPath))).toBe(false)
  })

  it('cleans up the staging directory even when the backup fails', async () => {
    await expect(
      runManualBackup(baseDeps({ estimateFreeBytes: () => 1, estimateSourceBytes: () => 1_000_000 }), false),
    ).rejects.toThrow()
    expect(fs.existsSync(path.dirname(stagingDbPath))).toBe(false)
  })

  it('throws a recognizable error when the picked folder is claimed by a different install', async () => {
    claimDestination(destinationDir, 'install-b')
    await expect(
      runManualBackup(baseDeps({ pickDestinationFolder: async () => destinationDir }), true),
    ).rejects.toThrow(`${DESTINATION_CLAIMED_BY_ANOTHER_INSTALL}:${destinationDir}`)
    // Rejected, not silently taken over — nothing gets persisted as "the"
    // destination on a rejected claim, and the identity file still names
    // the other install.
    expect(readBackupDestination(userDataPath)).toBeNull()
    expect(verifyDestination(destinationDir, 'install-b')).toBe(true)
    expect(verifyDestination(destinationDir, 'install-a')).toBe(false)
  })

  it('takes over a folder claimed by a different install when forceClaimDestination is true', async () => {
    claimDestination(destinationDir, 'install-b')
    const result = await runManualBackup(
      baseDeps({ pickDestinationFolder: async () => destinationDir }),
      true,
      true,
    )
    expect(result.destination).toBe(destinationDir)
    expect(readBackupDestination(userDataPath)).toBe(destinationDir)
    // The identity file must have actually been rewritten to this install
    // (installId 'install-a', per baseDeps) — not merely that the backup
    // itself proceeded, which a bug that ignored `force` entirely and just
    // silently skipped the claim check could also produce.
    expect(verifyDestination(destinationDir, 'install-a')).toBe(true)
  })

  it('takes over exactly the confirmed folder via explicitDestination, without re-opening the picker', async () => {
    claimDestination(destinationDir, 'install-b')
    let pickerCalled = false
    const result = await runManualBackup(
      baseDeps({
        pickDestinationFolder: async () => {
          pickerCalled = true
          return destinationDir
        },
      }),
      false,
      true,
      destinationDir,
    )
    expect(pickerCalled).toBe(false)
    expect(result.destination).toBe(destinationDir)
    expect(verifyDestination(destinationDir, 'install-a')).toBe(true)
  })
})

describe('runManualRestore', () => {
  let userDataPath: string
  let productPhotosDir: string
  let archivePath: string

  beforeEach(() => {
    userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-userdata-'))
    productPhotosDir = path.join(userDataPath, 'product-photos')
    fs.mkdirSync(productPhotosDir, { recursive: true })
    fs.writeFileSync(path.join(productPhotosDir, 'old-photo.jpg'), 'old')
    fs.writeFileSync(path.join(userDataPath, 'dev.db'), 'old-db')
    fs.writeFileSync(path.join(userDataPath, 'dev.db-wal'), 'stale-wal')
    archivePath = path.join(userDataPath, 'girovest-backup-2026-07-31-090503.zip')
    fs.writeFileSync(archivePath, 'fake-zip-bytes')
  })

  afterEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  })

  function baseDeps(overrides: Partial<Parameters<typeof runManualRestore>[0]> = {}) {
    return {
      archivePath,
      userDataPath,
      dbSidecarNames: ['dev.db-wal', 'dev.db-journal', 'dev.db-shm'],
      productPhotosDir,
      extractArchive: async (_zipPath: string, destDir: string) => {
        fs.writeFileSync(path.join(destDir, 'dev.db'), sqliteFile('restored-db-bytes'))
        fs.mkdirSync(path.join(destDir, 'product-photos'), { recursive: true })
        fs.writeFileSync(path.join(destDir, 'product-photos', 'new-photo.jpg'), 'new')
      },
      estimateFreeBytes: () => Number.MAX_SAFE_INTEGER,
      ...overrides,
    }
  }

  it('extracts to staging, then swaps dev.db and product-photos into place, clearing stale sidecars', async () => {
    const result = await runManualRestore(baseDeps())

    expect(result).toEqual({ photosRestored: true })
    expect(markerOf(path.join(userDataPath, 'dev.db'))).toBe('restored-db-bytes')
    expect(fs.existsSync(path.join(userDataPath, 'dev.db-wal'))).toBe(false)
    expect(fs.existsSync(path.join(productPhotosDir, 'old-photo.jpg'))).toBe(false)
    expect(fs.readFileSync(path.join(productPhotosDir, 'new-photo.jpg'), 'utf-8')).toBe('new')
    expect(fs.existsSync(path.join(userDataPath, 'restore-staging'))).toBe(false)
    expect(fs.existsSync(`${productPhotosDir}.old`)).toBe(false)
  })

  it('swaps dev.db and product-photos via rename, never via a copy', async () => {
    // Locks in the atomicity fix itself: every assertion in the happy-path
    // test above would also pass against a copy-then-delete implementation
    // (neither leaves a `.old`/staging leftover either), so it doesn't
    // actually prove the swap is atomic. This test does, by asserting the
    // one primitive a partial-write window depends on is never called.
    const copyFileSyncSpy = vi.spyOn(fs, 'copyFileSync')
    const cpSyncSpy = vi.spyOn(fs, 'cpSync')
    await runManualRestore(baseDeps())
    expect(copyFileSyncSpy).not.toHaveBeenCalled()
    expect(cpSyncSpy).not.toHaveBeenCalled()
    copyFileSyncSpy.mockRestore()
    cpSyncSpy.mockRestore()
  })

  it('restores cleanly when the backup had no product photos at all', async () => {
    await runManualRestore(
      baseDeps({
        extractArchive: async (_zipPath, destDir) => {
          fs.writeFileSync(path.join(destDir, 'dev.db'), sqliteFile('restored-db-bytes'))
          // No product-photos folder in this archive at all.
        },
      }),
    )

    expect(fs.existsSync(productPhotosDir)).toBe(true)
    expect(fs.readdirSync(productPhotosDir)).toEqual([])
  })

  it('leaves the original dev.db and product-photos untouched when the archive has no dev.db', async () => {
    await expect(
      runManualRestore(
        baseDeps({
          extractArchive: async () => {
            // Simulates a corrupt/foreign archive: extraction "succeeds" but
            // produces no dev.db.
          },
        }),
      ),
    ).rejects.toThrow(/dev\.db/)

    expect(fs.readFileSync(path.join(userDataPath, 'dev.db'), 'utf-8')).toBe('old-db')
    expect(fs.existsSync(path.join(userDataPath, 'dev.db-wal'))).toBe(true)
    expect(fs.readFileSync(path.join(productPhotosDir, 'old-photo.jpg'), 'utf-8')).toBe('old')
  })

  it('clears the pre-migration safety-copy marker so the next launch backs up before migrating', async () => {
    fs.writeFileSync(path.join(userDataPath, 'db-backup-version'), '0.8.0', 'utf-8')
    await runManualRestore(baseDeps())
    expect(fs.existsSync(path.join(userDataPath, 'db-backup-version'))).toBe(false)
  })

  it('does not throw and does not destroy the extracted photos when the FIRST photos rename fails after dev.db has already committed', async () => {
    // Regression test for the Critical finding: a failure anywhere in the
    // photos swap used to (a) propagate as "restore failed" even though
    // dev.db had already been renamed into place, and (b) destroy the
    // just-extracted replacement photos via an unconditional staging
    // cleanup, leaving no route back for either half. Simulates the
    // realistic trigger (a locked file on Windows) by making exactly the
    // productPhotosDir rename throw, while every other real fs call —
    // including the dev.db rename right before it — proceeds normally.
    // This is the "benign" branch: the live directory is never moved away,
    // so product-photos still exists (as the OLD content) throughout.
    const realRenameSync = fs.renameSync.bind(fs)
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
      if (String(oldPath) === productPhotosDir) {
        throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      }
      return realRenameSync(oldPath, newPath)
    })

    try {
      await expect(runManualRestore(baseDeps())).resolves.toEqual({ photosRestored: false })

      // The database committed — that's the whole point of treating its
      // rename as the point of no return.
      expect(markerOf(path.join(userDataPath, 'dev.db'))).toBe('restored-db-bytes')
      // The photos rename never completed, so the live directory was never
      // moved away — still the original, untouched, not deleted.
      expect(fs.existsSync(path.join(productPhotosDir, 'old-photo.jpg'))).toBe(true)
      // And the newly-extracted photos were NOT destroyed — still
      // recoverable from the staging directory, since the swap never got
      // far enough to need it deleted.
      expect(
        fs.existsSync(path.join(userDataPath, 'restore-staging', 'product-photos', 'new-photo.jpg')),
      ).toBe(true)
    } finally {
      renameSpy.mockRestore()
    }
  })

  it('does not throw when the SECOND photos rename fails, after the live directory was already moved aside', async () => {
    // The more dangerous branch of the same regression: the live directory
    // has already been renamed to product-photos.old by the time this
    // rename fails, so product-photos does not exist at all afterward.
    // Still must not throw (dev.db already committed), and the photos must
    // still be recoverable — either from product-photos.old (the original
    // content) or from restore-staging (the new content), not destroyed.
    const realRenameSync = fs.renameSync.bind(fs)
    const stagedPhotosDir = path.join(userDataPath, 'restore-staging', 'product-photos')
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
      if (String(oldPath) === stagedPhotosDir) {
        throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      }
      return realRenameSync(oldPath, newPath)
    })

    try {
      await expect(runManualRestore(baseDeps())).resolves.toEqual({ photosRestored: false })

      expect(markerOf(path.join(userDataPath, 'dev.db'))).toBe('restored-db-bytes')
      // The live directory was moved aside before the failing rename, so it
      // no longer exists at its normal path — but its content is not lost.
      expect(fs.existsSync(path.join(productPhotosDir, 'old-photo.jpg'))).toBe(false)
      expect(fs.existsSync(path.join(`${productPhotosDir}.old`, 'old-photo.jpg'))).toBe(true)
      // And the new content is still recoverable from staging, not destroyed.
      expect(fs.existsSync(path.join(stagedPhotosDir, 'new-photo.jpg'))).toBe(true)
    } finally {
      renameSpy.mockRestore()
    }
  })

  it('leaves the original dev.db untouched when the archive contains a dev.db that is not a valid SQLite file', async () => {
    await expect(
      runManualRestore(
        baseDeps({
          extractArchive: async (_zipPath, destDir) => {
            // A truncated/corrupt entry: right filename, wrong (or missing)
            // header — must not be treated as valid just because it exists.
            fs.writeFileSync(path.join(destDir, 'dev.db'), 'not-a-real-database')
          },
        }),
      ),
    ).rejects.toThrow(/valid dev\.db/)

    expect(fs.readFileSync(path.join(userDataPath, 'dev.db'), 'utf-8')).toBe('old-db')
    expect(fs.existsSync(path.join(userDataPath, 'dev.db-wal'))).toBe(true)
  })

  it('CRITICAL: refuses a truncated database that still starts with the SQLite magic', async () => {
    /*
      The failure that actually happens to a shop: the USB drive fills, the
      cable is pulled, or the machine dies mid-copy, and the archive holds a
      dev.db that begins perfectly and simply stops. Checking only the 16 magic
      bytes waved it through, and the next line atomically renamed it over her
      live database — a swap with no undo, on the one feature whose entire job
      is not losing her data.
    */
    await expect(
      runManualRestore(
        baseDeps({
          extractArchive: async (_zipPath, destDir) => {
            const complete = sqliteFile('restored-db-bytes')
            fs.writeFileSync(path.join(destDir, 'dev.db'), complete.subarray(0, complete.length - 200))
          },
        }),
      ),
    ).rejects.toThrow(/incomplete/i)

    expect(fs.readFileSync(path.join(userDataPath, 'dev.db'), 'utf-8')).toBe('old-db')
    // Pre-commit, so the sidecars it would have cleared are still there too.
    expect(fs.existsSync(path.join(userDataPath, 'dev.db-wal'))).toBe(true)
    expect(fs.existsSync(path.join(userDataPath, 'restore-staging'))).toBe(false)
  })

  it('refuses a file whose header declares an impossible page size', async () => {
    await expect(
      runManualRestore(
        baseDeps({
          extractArchive: async (_zipPath, destDir) => {
            const forged = sqliteFile('restored-db-bytes')
            forged.writeUInt16BE(999, 16) // not a power of two
            fs.writeFileSync(path.join(destDir, 'dev.db'), forged)
          },
        }),
      ),
    ).rejects.toThrow(/valid dev\.db/)

    expect(fs.readFileSync(path.join(userDataPath, 'dev.db'), 'utf-8')).toBe('old-db')
  })

  it('still accepts a database whose header page count cannot be trusted', async () => {
    // SQLite itself falls back to the file length when the change counter and
    // version-valid-for disagree, and so must this: refusing here would mean
    // she cannot restore her own data at all, which is worse than letting a
    // rare corruption be caught one step later.
    await runManualRestore(
      baseDeps({
        extractArchive: async (_zipPath, destDir) => {
          const legacy = sqliteFile('restored-db-bytes')
          legacy.writeUInt32BE(99, 92) // disagrees with the change counter
          fs.writeFileSync(path.join(destDir, 'dev.db'), legacy.subarray(0, legacy.length - 200))
        },
      }),
    )

    expect(markerOf(path.join(userDataPath, 'dev.db'))).toBe('restored-db-bytes')
  })

  it('refuses to start when there is not enough free space to restore', async () => {
    await expect(
      runManualRestore(baseDeps({ estimateFreeBytes: () => 1 })),
    ).rejects.toThrow(/space/i)

    expect(fs.readFileSync(path.join(userDataPath, 'dev.db'), 'utf-8')).toBe('old-db')
  })

  it('cleans up the staging directory even when extraction itself throws', async () => {
    await expect(
      runManualRestore(
        baseDeps({
          extractArchive: async () => {
            throw new Error('corrupt zip')
          },
        }),
      ),
    ).rejects.toThrow('corrupt zip')

    expect(fs.existsSync(path.join(userDataPath, 'restore-staging'))).toBe(false)
  })
})
