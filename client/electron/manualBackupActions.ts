import fs from 'fs'
import path from 'path'
import {
  readBackupDestination,
  writeBackupDestination,
  writeLastManualBackupAt,
  clearSnoozedUntil,
  verifyDestination,
  claimDestination,
  pruneExternalBackups,
  sweepStalePartialBackups,
  formatBackupTimestamp,
} from './manualBackup.ts'
import type { ArchiveSource } from './archive.ts'

export interface RunManualBackupDeps {
  userDataPath: string
  installId: string
  stagingDbPath: string
  productPhotosDir: string
  now: Date
  pickDestinationFolder: () => Promise<string | null>
  createArchive: (sources: ArchiveSource[], destZipPath: string) => Promise<void>
  estimateSourceBytes: () => number
  estimateFreeBytes: (destinationDir: string) => number
}

export interface RunManualBackupResult {
  destination: string
  archivePath: string
}

// Thrown when the picked/remembered folder's identity file belongs to a
// different install. Deliberately a recognizable message rather than a
// generic failure: the renderer catches this specifically to offer "use
// this folder anyway" instead of a dead end — this is exactly the shape of
// the disaster-recovery flow this feature exists for (restore onto a new
// machine, then back up again to the very USB drive just restored from,
// whose identity file still names the old, now-gone install).
export const DESTINATION_CLAIMED_BY_ANOTHER_INSTALL = 'DESTINATION_CLAIMED_BY_ANOTHER_INSTALL'

// Pure orchestration, deliberately free of ipcMain/dialog/archive-worker
// imports so it is unit-testable with fakes — see manualBackupActions.test.ts.
// main.ts's backup:run handler is a thin wrapper supplying the real
// dialog/archive-worker implementations.
export async function runManualBackup(
  deps: RunManualBackupDeps,
  chooseNewFolder: boolean,
  forceClaimDestination = false,
  // Set only on a force-retry after the user confirmed "use this folder
  // anyway" for a specific, already-picked folder — skips the picker
  // entirely and claims exactly that path, never a fresh pick. Without
  // this, a retry that re-opens the folder dialog could have the user
  // (accidentally or not) pick a *different* folder on the second try,
  // which would then be force-claimed with no further confirmation —
  // the consent the user gave was for one specific folder, not a
  // standing "skip this check" flag.
  explicitDestination?: string,
): Promise<RunManualBackupResult> {
  // The renderer is responsible for calling POST /api/backup/snapshot
  // (server-side, via better-sqlite3's online backup API) before invoking
  // this function — createArchive silently skips a source path that
  // doesn't exist, which is correct for product-photos (a brand-new shop
  // may not have any yet) and would be catastrophic for the database: a
  // missing snapshot must never silently produce a backup archive with no
  // database in it.
  if (!fs.existsSync(deps.stagingDbPath)) {
    throw new Error('No database snapshot was staged before starting the backup')
  }

  try {
    let destination = chooseNewFolder ? null : readBackupDestination(deps.userDataPath)
    if (destination === null || !verifyDestination(destination, deps.installId)) {
      const picked = explicitDestination ?? (await deps.pickDestinationFolder())
      if (picked === null) throw new Error('No destination folder selected')
      const claim = claimDestination(picked, deps.installId, forceClaimDestination)
      if (claim === 'mismatch') {
        // The rejected path is embedded (not just named generically) so a
        // caller that wants to offer "use this folder anyway" can retry
        // with `explicitDestination` scoped to exactly this folder, not a
        // fresh pick. Electron's ipcMain/ipcRenderer boundary preserves an
        // Error's message text (sometimes with an added prefix), so a
        // colon-delimited suffix survives the round trip; consumers should
        // locate the marker with indexOf/includes rather than assuming the
        // message starts with it.
        throw new Error(`${DESTINATION_CLAIMED_BY_ANOTHER_INSTALL}:${picked}`)
      }
      if (claim !== 'claimed') {
        throw new Error('Selected folder could not be claimed as a backup destination')
      }
      destination = picked
    }
    // Persisted as soon as it's picked/verified, not only after a successful
    // backup — otherwise a failed first backup to a newly-chosen folder
    // leaves the old, already-known-bad path remembered.
    writeBackupDestination(deps.userDataPath, destination)

    const freeBytes = deps.estimateFreeBytes(destination)
    const neededBytes = deps.estimateSourceBytes()
    if (freeBytes < neededBytes) {
      throw new Error(
        `Not enough free space at destination (need ~${Math.ceil(neededBytes / 1e6)}MB, have ~${Math.ceil(freeBytes / 1e6)}MB)`,
      )
    }

    sweepStalePartialBackups(destination)

    const timestamp = formatBackupTimestamp(deps.now)
    const finalName = `girovest-backup-${timestamp}.zip`
    const partialPath = path.join(destination, `.${finalName}.partial`)
    const finalPath = path.join(destination, finalName)

    await deps.createArchive(
      [
        { path: deps.stagingDbPath, kind: 'file', zipFolder: '' },
        { path: deps.productPhotosDir, kind: 'folder', zipFolder: 'product-photos' },
      ],
      partialPath,
    )
    fs.renameSync(partialPath, finalPath)

    writeLastManualBackupAt(deps.userDataPath, deps.now.toISOString())
    clearSnoozedUntil(deps.userDataPath)
    try {
      pruneExternalBackups(destination)
    } catch {
      // Non-fatal: the backup that was just written is real and complete —
      // see the design doc's Error handling section.
    }

    return { destination, archivePath: finalPath }
  } finally {
    // The staged snapshot is single-use: the renderer takes a fresh one
    // before every future attempt, so nothing needs this one to persist —
    // success or failure — and leaving it behind would keep a full,
    // unencrypted copy of the shop's database sitting in userData forever.
    fs.rmSync(path.dirname(deps.stagingDbPath), { recursive: true, force: true })
  }
}

export interface RunManualRestoreDeps {
  archivePath: string
  userDataPath: string
  dbSidecarNames: string[]
  productPhotosDir: string
  extractArchive: (zipPath: string, destDir: string) => Promise<void>
  estimateFreeBytes: (destinationDir: string) => number
}

// SQLite's own on-disk magic header (first 16 bytes of every valid database
// file, including one produced by better-sqlite3's online backup). Presence
// of a file named dev.db is not proof it IS one — a zero-length or
// truncated entry (e.g. from an archive made during an earlier crash) would
// otherwise pass an existsSync-only check and then destroy the live
// database when swapped in.
const SQLITE_HEADER = 'SQLite format 3\0'

/** Full SQLite header block; the fields read below all live inside it. */
const SQLITE_HEADER_BLOCK_BYTES = 100

/**
 * Confirms the staged file is a COMPLETE SQLite database, not merely one that
 * starts like one.
 *
 * The magic bytes alone were never enough: they are the first sixteen of a
 * file that can be hundreds of megabytes, so an archive truncated by a full
 * USB drive, a yanked cable, or a crash mid-write passed the check and then
 * atomically replaced the shop's live database with a corpse. That swap is
 * this function's point of no return and there is no undo.
 *
 * A complete database satisfies `pageSize * pageCount === fileSize`, and
 * SQLite records both numbers in its own header — so the file states its
 * intended length and can be checked against what actually arrived, with no
 * database engine involved. That matters here: this runs in the Electron main
 * process, which has no better-sqlite3 (it is the server child process that
 * owns the native module), so a real `PRAGMA integrity_check` would mean
 * adding a native dependency to the installer. This catches truncation, which
 * is the failure that actually happens to a shop copying to a USB stick.
 *
 * Deliberately PERMISSIVE where it cannot be sure: a false rejection here
 * means she cannot restore her own data at all, which is worse than the
 * corruption being caught one step later.
 */
function assertCompleteSqliteFile(dbPath: string): void {
  const header = Buffer.alloc(SQLITE_HEADER_BLOCK_BYTES)
  const fd = fs.openSync(dbPath, 'r')
  let bytesRead: number
  try {
    bytesRead = fs.readSync(fd, header, 0, header.length, 0)
  } finally {
    fs.closeSync(fd)
  }
  if (
    bytesRead < SQLITE_HEADER_BLOCK_BYTES ||
    header.subarray(0, SQLITE_HEADER.length).toString('latin1') !== SQLITE_HEADER
  ) {
    throw new Error('Backup archive does not contain a valid dev.db')
  }

  // Offset 16: page size in bytes. The value 1 is SQLite's encoding for 65536,
  // which does not fit the field; every other legal value is a power of two
  // from 512 to 32768.
  const rawPageSize = header.readUInt16BE(16)
  const pageSize = rawPageSize === 1 ? 65536 : rawPageSize
  if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0) {
    throw new Error('Backup archive does not contain a valid dev.db')
  }

  // Offset 28 is only authoritative when the change counter (offset 24) equals
  // the version-valid-for number (offset 92); otherwise SQLite itself falls
  // back to the file's actual length, and so must this. A snapshot from
  // backupService.ts's online backup always has them equal.
  const changeCounter = header.readUInt32BE(24)
  const pageCount = header.readUInt32BE(28)
  const versionValidFor = header.readUInt32BE(92)
  if (pageCount === 0 || versionValidFor !== changeCounter) return

  const expectedBytes = pageSize * pageCount
  const actualBytes = fs.statSync(dbPath).size
  if (actualBytes !== expectedBytes) {
    throw new Error(
      `Backup archive's dev.db is incomplete (header declares ${expectedBytes} bytes, file is ${actualBytes})`,
    )
  }
}

export interface RunManualRestoreResult {
  // False only when the database committed but the photos swap or
  // cleanup afterward failed (see the comment on the dev.db rename below)
  // — the restore as a whole still succeeded and the caller should still
  // relaunch, but this is the caller's one signal to log the fact that
  // product-photos may need manual recovery from `.old`/`restore-staging`,
  // since nothing below throws to report it directly.
  photosRestored: boolean
}

export async function runManualRestore(deps: RunManualRestoreDeps): Promise<RunManualRestoreResult> {
  const archiveBytes = fs.statSync(deps.archivePath).size
  const freeBytes = deps.estimateFreeBytes(deps.userDataPath)
  if (freeBytes < archiveBytes) {
    throw new Error(
      `Not enough free space to restore (need ~${Math.ceil(archiveBytes / 1e6)}MB, have ~${Math.ceil(freeBytes / 1e6)}MB)`,
    )
  }

  const stagingDir = path.join(deps.userDataPath, 'restore-staging')
  fs.rmSync(stagingDir, { recursive: true, force: true })
  fs.mkdirSync(stagingDir, { recursive: true })

  let stagedDbPath: string
  try {
    // Extract to a scratch location first and only swap once confirmed
    // complete — a corrupt/truncated archive must never leave the app with
    // a half-replaced database. Nothing live is touched up to this point,
    // so any failure here can simply clean up staging and stop: the restore
    // genuinely did not happen.
    await deps.extractArchive(deps.archivePath, stagingDir)
    stagedDbPath = path.join(stagingDir, 'dev.db')
    if (!fs.existsSync(stagedDbPath)) {
      throw new Error('Backup archive does not contain a dev.db')
    }
    assertCompleteSqliteFile(stagedDbPath)
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true })
    throw error
  }

  // The archive's dev.db is a sidecar-free online-backup snapshot (see
  // backupService.ts); stale sidecars left over from the just-stopped live
  // database must not linger and get replayed against the newly restored
  // file. Still pre-commit: if removal throws, dev.db hasn't been touched.
  for (const sidecar of deps.dbSidecarNames) {
    fs.rmSync(path.join(deps.userDataPath, sidecar), { force: true })
  }

  // renameSync, not copyFileSync: stagingDir lives inside userDataPath, so
  // this is a same-filesystem, atomic rename — there is no window where the
  // live dev.db sits truncated or partially written.
  //
  // This rename is the restore's point of no return. Everything after it
  // must never throw back to the caller: the database has committed, so
  // the restore has to be reported as successful (the caller still
  // relaunches) no matter what happens to the photos swap or cleanup below.
  // An earlier version of this function let a photos-swap failure here
  // propagate as "restore failed" — while dev.db had already changed AND
  // the unconditional `finally` cleanup below destroyed the just-extracted
  // replacement photos, leaving no route back for either half.
  fs.renameSync(stagedDbPath, path.join(deps.userDataPath, 'dev.db'))

  // Everything from here on is post-commit and must never throw back to
  // the caller: the database has already changed, so the restore has to
  // be reported as successful (the caller still relaunches) no matter
  // what happens to the marker clear, the photos swap, or cleanup below.
  // An earlier version of this function let a photos-swap failure
  // propagate as "restore failed" — while dev.db had already changed AND
  // an unconditional `finally` cleanup destroyed the just-extracted
  // replacement photos — and separately had the marker clear positioned
  // outside any guard at all, so it alone could still throw post-commit.
  // Both are folded into this one non-throwing block now.
  let photosRestored = false
  try {
    // Clears the pre-migration safety-copy marker (client/electron/
    // backup.ts's MARKER_FILENAME, referenced here by its literal name
    // rather than an import — this feature deliberately never imports
    // from backup.ts, to avoid coupling into its already-shipped internal
    // mechanism) so the next launch treats the restored database as an
    // unknown version and takes a safety copy before migrating. Without
    // this, a restored OLDER backup would silently skip that safety net:
    // the marker still names whichever version was installed before the
    // restore, which happens to match the app that's about to relaunch.
    fs.rmSync(path.join(deps.userDataPath, 'db-backup-version'), { force: true })

    // Swap the old directory aside (still recoverable) rather than deleting
    // it before the new one is in place.
    const stagedPhotosDir = path.join(stagingDir, 'product-photos')
    const oldPhotosDir = `${deps.productPhotosDir}.old`
    fs.rmSync(oldPhotosDir, { recursive: true, force: true })
    if (fs.existsSync(deps.productPhotosDir)) {
      fs.renameSync(deps.productPhotosDir, oldPhotosDir)
    }
    if (fs.existsSync(stagedPhotosDir)) {
      fs.renameSync(stagedPhotosDir, deps.productPhotosDir)
    } else {
      // A backup taken when the shop had zero product photos: leave a
      // fresh empty directory rather than none at all, matching what a
      // normal first launch already creates.
      fs.mkdirSync(deps.productPhotosDir, { recursive: true })
    }
    fs.rmSync(oldPhotosDir, { recursive: true, force: true })
    fs.rmSync(stagingDir, { recursive: true, force: true })
    photosRestored = true
  } catch {
    // Non-fatal by design — see the comment above the dev.db rename. The
    // database has already committed and this whole function still resolves
    // successfully either way. Deliberately does NOT delete stagingDir or
    // oldPhotosDir on this path: on Windows an AV scanner or sync client can
    // hold a lock long enough to throw EBUSY here, and the old unconditional
    // cleanup is exactly what turned that into permanent data loss — the
    // only copy of the newly-extracted photos, destroyed after the swap
    // that needed them had already failed. Worst case now is the photos
    // step didn't finish and the old and/or new copies are left sitting on
    // disk for manual recovery (product-photos.old, restore-staging/
    // product-photos), not silent loss. `photosRestored: false` is the
    // caller's only signal that this happened, since nothing here throws.
  }
  return { photosRestored }
}
