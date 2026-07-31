# Offline Backup Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Girovest shop owner (Electron desktop build) manually export their local SQLite data + product photos to a folder they control, remembers that destination, tracks a last-backup timestamp, nags via a Dashboard banner when overdue, and can restore a backup in-app.

**Architecture:** A consistent live-database snapshot is produced server-side via `better-sqlite3`'s online backup API (behind a new authenticated route), then zipped together with `product-photos` by a small child-process worker spawned from Electron's main process (so a large zip never blocks the UI), written atomically to a user-chosen destination folder. Reminder state (last backup, destination, snooze, install date) lives in plain marker files in `userData`, read by the renderer over a small new IPC surface. A pure function turns that status into "should the banner show," rendered identically by both the Settings page and a new Dashboard banner.

**Tech Stack:** Electron (main process, IPC), Express + Prisma/better-sqlite3 (server), React + react-i18next + TanStack Query (renderer), Vitest, adm-zip (new dependency, pure JS, no native bindings).

**Spec:** `docs/superpowers/specs/2026-07-31-offline-backup-reminder-design.md`

## Global Constraints

- Electron desktop build only — every renderer-side piece is gated by `typeof window.girovest !== 'undefined'`, checked synchronously (not the async `useInstallId` pattern). Nothing changes on the hosted web build except one new (unused-by-it) server route.
- Backup archive name: `girovest-backup-<YYYY-MM-DD-HHmmss>.zip` (full timestamp, not just a date).
- Retention: keep the 5 most recent (`MAX_EXTERNAL_BACKUPS = 5`) backups per destination folder, pruning only files matching that exact name pattern — never anything else in a user-chosen folder.
- All destination-folder writes are atomic: write to `.<name>.zip.partial`, rename to the final name only after the write completes; a stale `.partial` from a previous crashed run is swept before the next attempt.
- The manual-backup, destination, and snooze markers are plain text files in `userData`, trimmed on every read (`.trim()`) — an untrimmed read is a known prior failure mode in this codebase (see `client/electron/installId.ts`).
- The reminder clock: `daysSince(lastBackupAt ?? installDate) > 30`, not overdue while `snoozedUntil` is in the future. No permanent opt-out — snoozing repeats indefinitely by design.
- Never copy a live `dev.db` with a raw filesystem copy. The only sanctioned path to a consistent snapshot is the new server-side `better-sqlite3` `.backup()` route.
- No task in this plan touches `client/electron/backup.ts`'s existing internal upgrade-backup mechanism — it is a separate, already-shipped feature this one only reuses conventions from (never its code directly, to avoid regressing it).

---

## File Structure

New files:
- `client/electron/archive.ts` — zip/unzip primitives (adm-zip wrapper), no Electron dependency.
- `client/electron/archiveCli.ts` — spawnable CLI entry around `archive.ts`, built as a second `main`-target bundle output so it ships as a sibling of `out/main/index.js`.
- `client/electron/archiveRunner.ts` — spawns `archiveCli.js` as a child process and returns a promise (mirrors `runMigrations` in `main.ts`).
- `client/electron/manualBackup.ts` — marker read/write helpers, destination identity verification, retention pruning, directory size, install-date resolution.
- `client/electron/manualBackupActions.ts` — the testable orchestration core for "run a backup" and "run a restore," free of Electron imports (dialog/ipcMain/archive-worker are injected).
- `server/src/services/backupService.ts` — `createDatabaseSnapshot()`, the online-backup call.
- `server/src/routes/backup.ts` — `POST /api/backup/snapshot`.
- `client/src/lib/backupReminder.ts` — pure due/overdue calculation shared by Settings and the Dashboard banner.
- `client/src/features/settings/useBackupStatus.ts` — polling hook over the new IPC surface.
- `client/src/features/settings/BackupSection.tsx` — the Settings page's Backup + Restore UI.
- `client/src/features/dashboard/BackupReminderBanner.tsx` — the Dashboard banner.

Modified files:
- `client/package.json` — add `adm-zip` dependency.
- `client/electron.vite.config.ts` — second `main` build entry for `archiveCli.ts`.
- `client/electron/main.ts` — new IPC handlers, concurrency guard.
- `client/electron/preload.ts` — new bridge methods.
- `server/src/app.ts` — mount the new router.
- `client/src/features/settings/SettingsPage.tsx` — render `BackupSection`.
- `client/src/features/dashboard/DashboardPage.tsx` — render `BackupReminderBanner`.
- `client/src/locales/pt-BR/settings.json`, `client/src/locales/pt-BR/dashboard.json` — new strings.
- `docs/release-checklist.md` — manual backup/restore verification step.

---

### Task 1: Zip/unzip primitives (`archive.ts`)

**Files:**
- Create: `client/electron/archive.ts`
- Test: `client/electron/archive.test.ts`
- Modify: `client/package.json` (add `adm-zip` dependency)

**Interfaces:**
- Produces: `ArchiveSource { path: string; kind: 'file' | 'folder'; zipFolder: string }`, `createArchive(sources: ArchiveSource[], destZipPath: string): void`, `extractArchive(zipPath: string, destDir: string): void`.

- [ ] **Step 1: Add the `adm-zip` dependency**

```bash
cd client && npm install adm-zip
```

adm-zip is pure JavaScript with no native bindings — consistent with this app's general avoidance of native deps outside `bcrypt`/`better-sqlite3` (see the bundling note above `resolveServerEntry` in `client/electron/main.ts`).

- [ ] **Step 2: Write the failing test**

```typescript
// client/electron/archive.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createArchive, extractArchive } from './archive.ts'

describe('createArchive / extractArchive', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('zips a file and a folder, then extracts them back intact', () => {
    const dbPath = path.join(tmpDir, 'dev.db')
    fs.writeFileSync(dbPath, 'db-bytes')
    const photosDir = path.join(tmpDir, 'product-photos')
    fs.mkdirSync(path.join(photosDir, 'p1'), { recursive: true })
    fs.writeFileSync(path.join(photosDir, 'p1', 'photo.jpg'), 'jpg-bytes')

    const destZip = path.join(tmpDir, 'out.zip')
    createArchive(
      [
        { path: dbPath, kind: 'file', zipFolder: '' },
        { path: photosDir, kind: 'folder', zipFolder: 'product-photos' },
      ],
      destZip,
    )
    expect(fs.existsSync(destZip)).toBe(true)

    const extractDir = path.join(tmpDir, 'extracted')
    extractArchive(destZip, extractDir)
    expect(fs.readFileSync(path.join(extractDir, 'dev.db'), 'utf-8')).toBe('db-bytes')
    expect(fs.readFileSync(path.join(extractDir, 'product-photos', 'p1', 'photo.jpg'), 'utf-8')).toBe(
      'jpg-bytes',
    )
  })

  it('skips a source path that does not exist rather than throwing', () => {
    const dbPath = path.join(tmpDir, 'dev.db')
    fs.writeFileSync(dbPath, 'db-bytes')
    const destZip = path.join(tmpDir, 'out.zip')

    createArchive(
      [
        { path: dbPath, kind: 'file', zipFolder: '' },
        { path: path.join(tmpDir, 'missing-photos'), kind: 'folder', zipFolder: 'product-photos' },
      ],
      destZip,
    )

    const extractDir = path.join(tmpDir, 'extracted')
    extractArchive(destZip, extractDir)
    expect(fs.existsSync(path.join(extractDir, 'dev.db'))).toBe(true)
    expect(fs.existsSync(path.join(extractDir, 'product-photos'))).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npx vitest run electron/archive.test.ts`
Expected: FAIL — `Cannot find module './archive.ts'`

- [ ] **Step 4: Write the implementation**

```typescript
// client/electron/archive.ts
import AdmZip from 'adm-zip'
import fs from 'fs'

export interface ArchiveSource {
  path: string
  kind: 'file' | 'folder'
  // '' for the archive root; a folder name/prefix inside the archive
  // otherwise. For a `folder` source this is where its contents land; for a
  // `file` source this is the folder the file's own basename is placed under.
  zipFolder: string
}

// A source path that doesn't exist is skipped, not an error: product-photos
// may legitimately not exist yet on a brand-new shop with no product photos.
export function createArchive(sources: ArchiveSource[], destZipPath: string): void {
  const zip = new AdmZip()
  for (const source of sources) {
    if (!fs.existsSync(source.path)) continue
    if (source.kind === 'folder') {
      zip.addLocalFolder(source.path, source.zipFolder)
    } else {
      zip.addLocalFile(source.path, source.zipFolder)
    }
  }
  zip.writeZip(destZipPath)
}

export function extractArchive(zipPath: string, destDir: string): void {
  const zip = new AdmZip(zipPath)
  zip.extractAllTo(destDir, true)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run electron/archive.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add client/package.json client/package-lock.json client/electron/archive.ts client/electron/archive.test.ts
git commit -m "feat(backup): add zip/unzip primitives for the manual backup archive"
```

---

### Task 2: Archive worker CLI + spawn wrapper

**Files:**
- Create: `client/electron/archiveCli.ts`
- Create: `client/electron/archiveRunner.ts`
- Test: `client/electron/archiveRunner.test.ts`
- Modify: `client/electron.vite.config.ts`

**Interfaces:**
- Consumes: `ArchiveSource`, `createArchive`, `extractArchive` from Task 1's `archive.ts`.
- Produces: `resolveArchiveWorkerEntry(mainDirname: string): string`, `runCreateArchive(mainDirname: string, sources: ArchiveSource[], destZipPath: string): Promise<void>`, `runExtractArchive(mainDirname: string, zipPath: string, destDir: string): Promise<void>`.

A large zip of thousands of product photos is real CPU/IO work; running it inline in Electron's main process would freeze the whole app (no repaint, no IPC) for as long as it takes. `archiveCli.ts` runs as a separate Node process, the same way `client/electron/main.ts`'s `runMigrations` already spawns a separate process for the (much smaller) migration step rather than running it in-process.

- [ ] **Step 1: Add the second build entry**

In `client/electron.vite.config.ts`, `main.build.rollupOptions.input` currently has only `index`. `main.ts` already resolves sibling build outputs via `import.meta.dirname` (see its `preload: path.join(import.meta.dirname, '../preload/index.cjs')` and `win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))`), so a second entry here lands at `out/main/archiveCli.js`, right next to `out/main/index.js`, in both dev and packaged builds — no `isPackaged` branch needed, unlike the server's entry resolution.

The same `main` build target's `externalizeDepsPlugin` also needs `adm-zip` added to its `exclude` list, alongside the existing `electron-updater`/`electron-log` exclusions and for the identical reason spelled out in the comment already there: the packaged app ships only `out/**/*` + `package.json` — no client `node_modules` — so anything `archiveCli.js` imports that isn't bundled in has nothing to resolve against at runtime. Without this, `electron:dev` works fine (client `node_modules` is on disk there) and a packaged build throws `ERR_MODULE_NOT_FOUND` on the first backup attempt.

```typescript
// client/electron.vite.config.ts
    // electron-updater/electron-log/adm-zip are excluded from externalization
    // (i.e. bundled into out/main) because the packaged app ships only
    // out/**/* + package.json — no client node_modules to resolve them from
    // at runtime. adm-zip is pure JS (no native bindings), so bundling it is
    // safe the same way the other two already are.
    plugins: [externalizeDepsPlugin({ exclude: ['electron-updater', 'electron-log', 'adm-zip'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
          archiveCli: resolve(__dirname, 'electron/archiveCli.ts'),
        },
      },
    },
```

(This replaces the existing `plugins: [externalizeDepsPlugin({ exclude: ['electron-updater', 'electron-log'] })]` line and the existing single-entry `input: { index: resolve(__dirname, 'electron/main.ts') }` under `main.build.rollupOptions`, both in the same `main:` block.)

- [ ] **Step 2: Write `archiveCli.ts`**

```typescript
// client/electron/archiveCli.ts
import { createArchive, extractArchive, type ArchiveSource } from './archive.ts'

// Spawned as a standalone Node process by archiveRunner.ts — see its comment
// for why. argv: [execPath, thisFile, mode, jsonArgs].
const [, , mode, argJson] = process.argv

try {
  if (mode === 'create') {
    const { sources, destZipPath } = JSON.parse(argJson ?? '{}') as {
      sources: ArchiveSource[]
      destZipPath: string
    }
    createArchive(sources, destZipPath)
  } else if (mode === 'extract') {
    const { zipPath, destDir } = JSON.parse(argJson ?? '{}') as { zipPath: string; destDir: string }
    extractArchive(zipPath, destDir)
  } else {
    throw new Error(`Unknown archive mode: ${String(mode)}`)
  }
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
```

- [ ] **Step 3: Write the failing test for the resolver**

```typescript
// client/electron/archiveRunner.test.ts
import { describe, it, expect } from 'vitest'
import path from 'path'
import { resolveArchiveWorkerEntry } from './archiveRunner.ts'

describe('resolveArchiveWorkerEntry', () => {
  it('resolves to archiveCli.js next to the given main-process directory', () => {
    expect(resolveArchiveWorkerEntry('/app/out/main')).toBe(path.join('/app/out/main', 'archiveCli.js'))
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd client && npx vitest run electron/archiveRunner.test.ts`
Expected: FAIL — `Cannot find module './archiveRunner.ts'`

- [ ] **Step 5: Write `archiveRunner.ts`**

```typescript
// client/electron/archiveRunner.ts
import { spawn } from 'child_process'
import path from 'path'
import type { ArchiveSource } from './archive.ts'

export function resolveArchiveWorkerEntry(mainDirname: string): string {
  return path.join(mainDirname, 'archiveCli.js')
}

function runArchiveCli(mainDirname: string, mode: 'create' | 'extract', args: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [resolveArchiveWorkerEntry(mainDirname), mode, JSON.stringify(args)],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'pipe' },
    )
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`archive worker exited with code ${code}: ${stderr.trim()}`))
    })
    child.on('error', reject)
  })
}

export function runCreateArchive(
  mainDirname: string,
  sources: ArchiveSource[],
  destZipPath: string,
): Promise<void> {
  return runArchiveCli(mainDirname, 'create', { sources, destZipPath })
}

export function runExtractArchive(mainDirname: string, zipPath: string, destDir: string): Promise<void> {
  return runArchiveCli(mainDirname, 'extract', { zipPath, destDir })
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd client && npx vitest run electron/archiveRunner.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add client/electron.vite.config.ts client/electron/archiveCli.ts client/electron/archiveRunner.ts client/electron/archiveRunner.test.ts
git commit -m "feat(backup): spawn zip/unzip work in a separate process"
```

---

### Task 3: Manual-backup markers, retention, and install date

**Files:**
- Create: `client/electron/manualBackup.ts`
- Test: `client/electron/manualBackup.test.ts`

**Interfaces:**
- Produces: `readBackupDestination`, `writeBackupDestination`, `readLastManualBackupAt`, `writeLastManualBackupAt`, `readSnoozedUntil`, `writeSnoozedUntil`, `clearSnoozedUntil`, `verifyOrClaimDestination(destinationDir: string, installId: string): boolean`, `formatBackupTimestamp(date: Date): string`, `parseBackupTimestamp(fileName: string): string | null`, `pruneExternalBackups(destinationDir: string, max?: number): void`, `sweepStalePartialBackups(destinationDir: string): void`, `getDirectorySizeBytes(dirPath: string): number`, `resolveInstallDate(userDataPath: string): string`, `MAX_EXTERNAL_BACKUPS = 5`.

- [ ] **Step 1: Write the failing tests**

```typescript
// client/electron/manualBackup.test.ts
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
  verifyOrClaimDestination,
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

describe('verifyOrClaimDestination', () => {
  let destinationDir: string

  beforeEach(() => {
    destinationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-dest-test-'))
  })

  afterEach(() => {
    fs.rmSync(destinationDir, { recursive: true, force: true })
  })

  it('claims a fresh folder on first use', () => {
    expect(verifyOrClaimDestination(destinationDir, 'install-a')).toBe(true)
    expect(fs.readFileSync(path.join(destinationDir, '.girovest-backup-destination'), 'utf-8')).toBe(
      'install-a',
    )
  })

  it('verifies a folder already claimed by this install', () => {
    verifyOrClaimDestination(destinationDir, 'install-a')
    expect(verifyOrClaimDestination(destinationDir, 'install-a')).toBe(true)
  })

  it('rejects a folder claimed by a different install id', () => {
    verifyOrClaimDestination(destinationDir, 'install-a')
    expect(verifyOrClaimDestination(destinationDir, 'install-b')).toBe(false)
  })

  it('rejects a folder that does not exist', () => {
    expect(verifyOrClaimDestination(path.join(destinationDir, 'missing'), 'install-a')).toBe(false)
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
    const realStat = fs.statSync(path.join(userData, 'install-id'))
    vi.spyOn(fs, 'statSync').mockReturnValueOnce({
      ...realStat,
      birthtimeMs: 0,
      birthtime: new Date(0),
    } as fs.Stats)
    expect(resolveInstallDate(userData)).toBe(realStat.mtime.toISOString())
  })

  it('degrades to "now" when install-id does not exist yet', () => {
    const result = resolveInstallDate(userData)
    expect(new Date(result).toString()).not.toBe('Invalid Date')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run electron/manualBackup.test.ts`
Expected: FAIL — `Cannot find module './manualBackup.ts'`

- [ ] **Step 3: Write the implementation**

```typescript
// client/electron/manualBackup.ts
import fs from 'fs'
import path from 'path'

const DESTINATION_MARKER = 'backup-destination'
const LAST_BACKUP_MARKER = 'last-manual-backup-at'
const SNOOZE_MARKER = 'backup-reminder-snoozed-until'
const DESTINATION_IDENTITY_FILE = '.girovest-backup-destination'
const BACKUP_NAME_PATTERN = /^girovest-backup-(\d{4}-\d{2}-\d{2}-\d{6})\.zip$/

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

// Verifies (or claims, on first use) that `destinationDir` is a folder this
// install has backed up to before — not merely a folder that happens to sit
// at a remembered path (a different USB stick reusing the same drive
// letter, a stale mount point). See the design doc's Destination memory
// section.
export function verifyOrClaimDestination(destinationDir: string, installId: string): boolean {
  if (!fs.existsSync(destinationDir)) return false
  const identityPath = path.join(destinationDir, DESTINATION_IDENTITY_FILE)
  if (!fs.existsSync(identityPath)) {
    fs.writeFileSync(identityPath, installId, 'utf-8')
    return true
  }
  return fs.readFileSync(identityPath, 'utf-8').trim() === installId
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
// limit of — a real backup.
export function sweepStalePartialBackups(destinationDir: string): void {
  for (const name of fs.readdirSync(destinationDir)) {
    if (name.endsWith('.zip.partial')) {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run electron/manualBackup.test.ts`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add client/electron/manualBackup.ts client/electron/manualBackup.test.ts
git commit -m "feat(backup): add manual-backup markers, retention, and install-date resolution"
```

---

### Task 4: Reminder due-calculation (pure)

**Files:**
- Create: `client/src/lib/backupReminder.ts`
- Test: `client/src/lib/backupReminder.test.ts`

**Interfaces:**
- Produces: `BackupReminderStatus { lastBackupAt: string | null; installDate: string; snoozedUntil: string | null }`, `BackupReminderState { overdue: boolean; neverBackedUp: boolean; daysOverdue: number }`, `computeBackupReminderState(status: BackupReminderStatus, now: Date): BackupReminderState`, `BACKUP_GRACE_DAYS = 30`.

- [ ] **Step 1: Write the failing tests**

```typescript
// client/src/lib/backupReminder.test.ts
import { describe, it, expect } from 'vitest'
import { computeBackupReminderState } from './backupReminder.ts'

const NOW = new Date('2026-08-15T12:00:00.000Z')

describe('computeBackupReminderState', () => {
  it('is not overdue within the 30-day grace period after install, with no backup yet', () => {
    const state = computeBackupReminderState(
      { lastBackupAt: null, installDate: '2026-08-01T00:00:00.000Z', snoozedUntil: null },
      NOW,
    )
    expect(state.overdue).toBe(false)
    expect(state.neverBackedUp).toBe(true)
  })

  it('is overdue once the install is more than 30 days old with no backup', () => {
    const state = computeBackupReminderState(
      { lastBackupAt: null, installDate: '2026-06-01T00:00:00.000Z', snoozedUntil: null },
      NOW,
    )
    expect(state.overdue).toBe(true)
    expect(state.neverBackedUp).toBe(true)
    expect(state.daysOverdue).toBeGreaterThan(0)
  })

  it('is not overdue when the last backup is recent', () => {
    const state = computeBackupReminderState(
      { lastBackupAt: '2026-08-10T00:00:00.000Z', installDate: '2026-01-01T00:00:00.000Z', snoozedUntil: null },
      NOW,
    )
    expect(state.overdue).toBe(false)
    expect(state.neverBackedUp).toBe(false)
  })

  it('is overdue when the last backup is more than 30 days old', () => {
    const state = computeBackupReminderState(
      { lastBackupAt: '2026-06-01T00:00:00.000Z', installDate: '2026-01-01T00:00:00.000Z', snoozedUntil: null },
      NOW,
    )
    expect(state.overdue).toBe(true)
  })

  it('is not overdue while a future snooze is active, even if otherwise overdue', () => {
    const state = computeBackupReminderState(
      {
        lastBackupAt: '2026-06-01T00:00:00.000Z',
        installDate: '2026-01-01T00:00:00.000Z',
        snoozedUntil: '2026-08-20T00:00:00.000Z',
      },
      NOW,
    )
    expect(state.overdue).toBe(false)
  })

  it('is overdue again once an expired snooze has passed', () => {
    const state = computeBackupReminderState(
      {
        lastBackupAt: '2026-06-01T00:00:00.000Z',
        installDate: '2026-01-01T00:00:00.000Z',
        snoozedUntil: '2026-08-10T00:00:00.000Z',
      },
      NOW,
    )
    expect(state.overdue).toBe(true)
  })

  it('is not overdue at exactly 30 days, and is overdue at 31', () => {
    const exactlyThirty = computeBackupReminderState(
      { lastBackupAt: null, installDate: '2026-07-16T12:00:00.000Z', snoozedUntil: null },
      NOW,
    )
    expect(exactlyThirty.overdue).toBe(false)

    const thirtyOne = computeBackupReminderState(
      { lastBackupAt: null, installDate: '2026-07-15T12:00:00.000Z', snoozedUntil: null },
      NOW,
    )
    expect(thirtyOne.overdue).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/lib/backupReminder.test.ts`
Expected: FAIL — `Cannot find module './backupReminder.ts'`

- [ ] **Step 3: Write the implementation**

```typescript
// client/src/lib/backupReminder.ts
export interface BackupReminderStatus {
  lastBackupAt: string | null
  installDate: string
  snoozedUntil: string | null
}

export interface BackupReminderState {
  overdue: boolean
  neverBackedUp: boolean
  daysOverdue: number
}

export const BACKUP_GRACE_DAYS = 30
const MS_PER_DAY = 24 * 60 * 60 * 1000

export function computeBackupReminderState(
  status: BackupReminderStatus,
  now: Date,
): BackupReminderState {
  const since = status.lastBackupAt ?? status.installDate
  const daysSince = Math.floor((now.getTime() - new Date(since).getTime()) / MS_PER_DAY)
  const snoozed = status.snoozedUntil !== null && now.getTime() < new Date(status.snoozedUntil).getTime()

  return {
    neverBackedUp: status.lastBackupAt === null,
    daysOverdue: Math.max(daysSince - BACKUP_GRACE_DAYS, 0),
    overdue: daysSince > BACKUP_GRACE_DAYS && !snoozed,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/lib/backupReminder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/backupReminder.ts client/src/lib/backupReminder.test.ts
git commit -m "feat(backup): add pure backup-reminder due-date calculation"
```

---

### Task 5: Server snapshot route

**Files:**
- Create: `server/src/services/backupService.ts`
- Create: `server/src/routes/backup.ts`
- Test: `server/src/routes/backup.test.ts`
- Modify: `server/src/app.ts`

**Interfaces:**
- Consumes: `databaseUrlToPath` from `server/src/db/migrationRunner.ts` (already exported).
- Produces: `createDatabaseSnapshot(): Promise<string>` (the staged snapshot's absolute path); `backupRouter` mounted at `/api/backup`, exposing `POST /api/backup/snapshot` → `{ path: string }`.

- [ ] **Step 1: Write the failing route test**

```typescript
// server/src/routes/backup.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import Database from 'better-sqlite3'
import { app } from '../app.js'
import { prisma } from '../db/client.js'
import { signStaffToken } from '../auth/jwt.js'

let staffToken: string

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  const staff = await prisma.staff.create({
    data: {
      name: 'S',
      login: `staff-${Date.now()}-${Math.random()}`,
      passwordHash: 'x',
      role: 'staff',
      locationId: location.id,
    },
  })
  staffToken = signStaffToken({ staffId: staff.id, role: 'staff' })
})

afterEach(async () => {
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('POST /api/backup/snapshot', () => {
  it('rejects a request with no auth token', async () => {
    await request(app).post('/api/backup/snapshot').expect(401)
  })

  it('writes a valid, openable snapshot of the live database', async () => {
    const response = await request(app)
      .post('/api/backup/snapshot')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200)

    expect(fs.existsSync(response.body.path)).toBe(true)
    const snapshot = new Database(response.body.path, { readonly: true, fileMustExist: true })
    expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok')
    snapshot.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/routes/backup.test.ts`
Expected: FAIL — `Cannot find module '../app.js'` resolving `backupRouter`, or a 404/import error, since the route doesn't exist yet.

- [ ] **Step 3: Write `backupService.ts`**

```typescript
// server/src/services/backupService.ts
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { databaseUrlToPath } from '../db/migrationRunner.js'

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
  const sourcePath = databaseUrlToPath(process.env.DATABASE_URL ?? 'file:./dev.db')
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
```

- [ ] **Step 4: Write `backup.ts` route + mount it**

```typescript
// server/src/routes/backup.ts
import { Router } from 'express'
import { requireAuth } from '../auth/authMiddleware.js'
import { createDatabaseSnapshot } from '../services/backupService.js'

export const backupRouter = Router()
backupRouter.use(requireAuth)

backupRouter.post('/snapshot', async (_req, res) => {
  const snapshotPath = await createDatabaseSnapshot()
  res.json({ path: snapshotPath })
})
```

In `server/src/app.ts`, add the import next to the other routers and mount it above the trailing comment:

```typescript
import { backupRouter } from './routes/backup.js'
```

```typescript
app.use('/api/backup', backupRouter)
```

(Placed alongside the existing `app.use('/api/settings', locationSettingsRouter)` line, still above the `// Always add new routers ABOVE this comment` marker.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run src/routes/backup.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/services/backupService.ts server/src/routes/backup.ts server/src/routes/backup.test.ts server/src/app.ts
git commit -m "feat(backup): add authenticated live-database snapshot route"
```

---

### Task 6: Backup/restore orchestration core (testable, Electron-free)

**Files:**
- Create: `client/electron/manualBackupActions.ts`
- Test: `client/electron/manualBackupActions.test.ts`

**Interfaces:**
- Consumes: `readBackupDestination`, `writeBackupDestination`, `writeLastManualBackupAt`, `clearSnoozedUntil`, `verifyDestination`, `claimDestination`, `pruneExternalBackups`, `sweepStalePartialBackups`, `formatBackupTimestamp` from Task 3's `manualBackup.ts`. (Task 3's review split the original single `verifyOrClaimDestination` into two functions with distinct semantics — `verifyDestination` for reusing a *remembered* path without re-prompting, which must reject on a missing identity file, not just a mismatched one; `claimDestination` for a path the user just picked via the folder dialog, which may claim on a missing identity file. Use each where its semantics fit: `verifyDestination` when checking a remembered destination, `claimDestination` after the folder picker returns a freshly-chosen path.)
- Produces: `RunManualBackupDeps`, `RunManualBackupResult { destination: string; archivePath: string }`, `runManualBackup(deps: RunManualBackupDeps, chooseNewFolder: boolean): Promise<RunManualBackupResult>`; `RunManualRestoreDeps`, `runManualRestore(deps: RunManualRestoreDeps): Promise<void>`.

This is the orchestration logic behind `backup:run` and `backup:restore`, deliberately free of `electron`/`dialog`/`ipcMain` imports — dialog interaction and the archive worker are injected — so the actual decision logic (destination resolution, atomic write, marker updates, extract-then-swap) is unit-testable. `main.ts` (Task 7) supplies the real implementations.

- [ ] **Step 1: Write the failing tests**

```typescript
// client/electron/manualBackupActions.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { runManualBackup, runManualRestore } from './manualBackupActions.ts'
import { readBackupDestination, readLastManualBackupAt, writeSnoozedUntil } from './manualBackup.ts'

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
})

// A real, valid SQLite file starts with this exact 16-byte header — the
// fakes below write it so the implementation's header check (a real
// safety gate, not incidental) passes for a "good" restored database and
// meaningfully fails for a corrupt/foreign one.
const SQLITE_HEADER = 'SQLite format 3\0'

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
        fs.writeFileSync(path.join(destDir, 'dev.db'), `${SQLITE_HEADER}restored-db-bytes`)
        fs.mkdirSync(path.join(destDir, 'product-photos'), { recursive: true })
        fs.writeFileSync(path.join(destDir, 'product-photos', 'new-photo.jpg'), 'new')
      },
      estimateFreeBytes: () => Number.MAX_SAFE_INTEGER,
      ...overrides,
    }
  }

  it('extracts to staging, then swaps dev.db and product-photos into place, clearing stale sidecars', async () => {
    await runManualRestore(baseDeps())

    expect(fs.readFileSync(path.join(userDataPath, 'dev.db'), 'utf-8')).toBe(`${SQLITE_HEADER}restored-db-bytes`)
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
          fs.writeFileSync(path.join(destDir, 'dev.db'), `${SQLITE_HEADER}restored-db-bytes`)
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run electron/manualBackupActions.test.ts`
Expected: FAIL — `Cannot find module './manualBackupActions.ts'`

- [ ] **Step 3: Write the implementation**

```typescript
// client/electron/manualBackupActions.ts
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

// Pure orchestration, deliberately free of ipcMain/dialog/archive-worker
// imports so it is unit-testable with fakes — see manualBackupActions.test.ts.
// main.ts's backup:run handler is a thin wrapper supplying the real
// dialog/archive-worker implementations.
export async function runManualBackup(
  deps: RunManualBackupDeps,
  chooseNewFolder: boolean,
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
      const picked = await deps.pickDestinationFolder()
      if (picked === null) throw new Error('No destination folder selected')
      if (!claimDestination(picked, deps.installId)) {
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

export async function runManualRestore(deps: RunManualRestoreDeps): Promise<void> {
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

  try {
    // Extract to a scratch location first and only swap once confirmed
    // complete — a corrupt/truncated archive must never leave the app with
    // a half-replaced database.
    await deps.extractArchive(deps.archivePath, stagingDir)
    const stagedDbPath = path.join(stagingDir, 'dev.db')
    if (!fs.existsSync(stagedDbPath)) {
      throw new Error('Backup archive does not contain a dev.db')
    }
    const header = Buffer.alloc(SQLITE_HEADER.length)
    const fd = fs.openSync(stagedDbPath, 'r')
    try {
      fs.readSync(fd, header, 0, header.length, 0)
    } finally {
      fs.closeSync(fd)
    }
    if (header.toString('latin1') !== SQLITE_HEADER) {
      throw new Error('Backup archive does not contain a valid dev.db')
    }

    // The archive's dev.db is a sidecar-free online-backup snapshot (see
    // backupService.ts); stale sidecars left over from the just-stopped
    // live database must not linger and get replayed against the newly
    // restored file.
    for (const sidecar of deps.dbSidecarNames) {
      fs.rmSync(path.join(deps.userDataPath, sidecar), { force: true })
    }
    // renameSync, not copyFileSync: stagingDir lives inside userDataPath,
    // so this is a same-filesystem, atomic rename — there is no window
    // where the live dev.db sits truncated or partially written. A plain
    // copy would stream bytes into the live file in place, and a failure
    // partway through (disk full, I/O error, power loss) would leave a
    // corrupt live database with its sidecars already gone and nothing to
    // recover from.
    fs.renameSync(stagedDbPath, path.join(deps.userDataPath, 'dev.db'))

    // Same reasoning for photos: swap the old directory aside (still
    // recoverable) rather than deleting it before the new one is in place.
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
    // Both live swaps (dev.db, product-photos) are already complete and
    // correct by this point — everything below is disk-hygiene cleanup,
    // not correctness. On Windows an AV scanner or a sync client can hold
    // a lock long enough to throw EBUSY here; that must never surface as
    // "the restore failed" (which would also skip the relaunch below) for
    // a restore that, in fact, fully succeeded. Same rationale as
    // pruneExternalBackups's non-fatal catch in the backup path.
    try {
      fs.rmSync(oldPhotosDir, { recursive: true, force: true })
    } catch {
      // Non-fatal: stale `.old` is swept unconditionally at the top of the
      // next restore attempt (line 1453 above).
    }
  } finally {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true })
    } catch {
      // Non-fatal for the same reason: the swap above already succeeded or
      // failed and threw its own error, and this is only scratch space —
      // see runManualBackup's identical `finally` for the sibling case.
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run electron/manualBackupActions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/electron/manualBackupActions.ts client/electron/manualBackupActions.test.ts
git commit -m "feat(backup): add testable backup/restore orchestration core"
```

---

### Task 7: Electron main process wiring (IPC handlers + preload bridge)

**Files:**
- Modify: `client/electron/main.ts`
- Modify: `client/electron/preload.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6 (`runCreateArchive`/`runExtractArchive` from `archiveRunner.ts`; markers + `parseBackupTimestamp`/`resolveInstallDate`/`getDirectorySizeBytes` from `manualBackup.ts`; `runManualBackup`/`runManualRestore` from `manualBackupActions.ts`); `resolveProductPhotosDir`, `resolveInstallId` (already in `main.ts`).
- Produces: IPC channels `backup:status`, `backup:run`, `backup:snooze`, `backup:pickRestoreFile`, `backup:restore`; preload bridge methods `getBackupStatus`, `runBackup`, `snoozeBackupReminder`, `pickRestoreBackup`, `restoreBackup`.

No automated test for this task — matches this codebase's own convention (`main.test.ts` unit-tests `main.ts`'s pure resolver functions, e.g. `resolveServerCwd`, but not `runMigrations` itself, which is spawn/IPC glue). Verified manually in Task 9.

- [ ] **Step 1: Add the imports**

At the top of `client/electron/main.ts`, alongside the existing `backupDatabaseIfNeeded, writeBackupMarker` import from `./backup.ts`:

```typescript
import { runCreateArchive, runExtractArchive } from './archiveRunner.ts'
import {
  readBackupDestination,
  readLastManualBackupAt,
  readSnoozedUntil,
  writeSnoozedUntil,
  parseBackupTimestamp,
  getDirectorySizeBytes,
  resolveInstallDate,
} from './manualBackup.ts'
import { runManualBackup, runManualRestore, type RunManualBackupResult } from './manualBackupActions.ts'
```

Also add this exported helper, alongside the existing `waitForPortFree` (same file, same testable-pure-function style — `main.ts` already unit-tests its resolver/wait helpers directly, see `main.test.ts`):

```typescript
// serverProcess.kill() is asynchronous — the OS may not have actually torn
// the process down by the time `kill()` returns. Restore mutates dev.db's
// sidecars and then renames a file over the live dev.db; on Windows in
// particular, deleting or renaming over a file the just-killed server
// process still has open throws EBUSY/EPERM, and unlike waitForPortFree's
// existing use for the *next* server's startup, there was previously
// nothing making the *current* restore wait for the *old* server to
// actually be gone first.
export function waitForProcessExit(child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}
```

- [ ] **Step 2: Register the handlers**

Inside `app.whenReady().then(async () => { ... })`, immediately after the existing `ipcMain.handle('activation:retry', ...)` block (same placement rationale: needs `win` as the dialog parent, which only exists after `createWindow`). This scope already has `const userDataPath = app.getPath('userData')` and `installId` declared a few lines above (used by `resolveActivation`) — the new handlers close over and reuse those, the same way `activation:retry` reuses `installId` rather than recomputing it:

```typescript
    let backupRunPromise: Promise<RunManualBackupResult> | null = null

    ipcMain.handle('backup:status', () => {
      return {
        lastBackupAt: readLastManualBackupAt(userDataPath),
        destination: readBackupDestination(userDataPath),
        snoozedUntil: readSnoozedUntil(userDataPath),
        installDate: resolveInstallDate(userDataPath),
        inProgress: backupRunPromise !== null,
      }
    })

    ipcMain.handle('backup:run', async (_event, args: { chooseNewFolder?: boolean } = {}) => {
      if (backupRunPromise) return backupRunPromise
      const stagingDbPath = path.join(userDataPath, 'backup-staging', 'dev.db')
      const productPhotosDir = resolveProductPhotosDir(userDataPath)

      backupRunPromise = runManualBackup(
        {
          userDataPath,
          installId,
          stagingDbPath,
          productPhotosDir,
          now: new Date(),
          pickDestinationFolder: async () => {
            const result = await dialog.showOpenDialog(win, {
              properties: ['openDirectory', 'createDirectory'],
            })
            return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]!
          },
          createArchive: (sources, destZipPath) =>
            runCreateArchive(import.meta.dirname, sources, destZipPath),
          estimateSourceBytes: () =>
            (fs.existsSync(stagingDbPath) ? fs.statSync(stagingDbPath).size : 0) +
            getDirectorySizeBytes(productPhotosDir),
          estimateFreeBytes: (destinationDir) => {
            try {
              const stats = fs.statfsSync(destinationDir)
              return stats.bavail * stats.bsize
            } catch {
              // Best-effort: an older platform/Node without fs.statfsSync
              // support should not block the backup on a check it can't run.
              return Number.POSITIVE_INFINITY
            }
          },
        },
        args.chooseNewFolder ?? false,
      )
      try {
        return await backupRunPromise
      } finally {
        backupRunPromise = null
      }
    })

    ipcMain.handle('backup:snooze', () => {
      writeSnoozedUntil(userDataPath, new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString())
    })

    ipcMain.handle('backup:pickRestoreFile', async () => {
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Girovest Backup', extensions: ['zip'] }],
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const filePath = result.filePaths[0]!
      return { path: filePath, timestamp: parseBackupTimestamp(path.basename(filePath)) }
    })

    ipcMain.handle('backup:restore', async (_event, args: { path: string }) => {
      isShuttingDown = true
      const dyingServer = serverProcess
      serverProcess?.kill()
      // Must actually be gone, not just asked to go, before touching
      // dev.db's sidecars or renaming over the live file — see
      // waitForProcessExit's comment.
      if (dyingServer) await waitForProcessExit(dyingServer)
      try {
        await runManualRestore({
          archivePath: args.path,
          userDataPath,
          dbSidecarNames: ['dev.db-wal', 'dev.db-journal', 'dev.db-shm'],
          productPhotosDir: resolveProductPhotosDir(userDataPath),
          extractArchive: (zipPath, destDir) => runExtractArchive(import.meta.dirname, zipPath, destDir),
          estimateFreeBytes: (destinationDir) => {
            try {
              const stats = fs.statfsSync(destinationDir)
              return stats.bavail * stats.bsize
            } catch {
              return Number.POSITIVE_INFINITY
            }
          },
        })
      } catch (error) {
        // A failed restore (bad archive, insufficient space) leaves the
        // live dev.db/product-photos untouched per runManualRestore's own
        // guarantee — but this handler already killed serverProcess before
        // attempting it, so the app must restart the backend to remain
        // usable rather than sitting dead. Same startServer() the app calls
        // on launch; migrations/backupDatabaseIfNeeded are idempotent
        // against an unchanged database, so re-running them here is safe.
        isShuttingDown = false
        const restartError = await startServer()
        if (restartError !== null) {
          dialog.showErrorBox(
            'Restore Failed',
            `The backup could not be restored, and the application server failed to restart.\n\n${restartError}`,
          )
        }
        throw error
      }
      app.relaunch()
      app.exit(0)
    })
```

`backupRunPromise` is the concurrency guard: the Settings page and the Dashboard banner both call `backup:run`; a second call while one is in flight returns the same promise instead of starting a second copy into the same destination.

- [ ] **Step 3: Add the preload bridge methods**

```typescript
// client/electron/preload.ts — added to the existing exposeInMainWorld('girovest', { ... }) object
  getBackupStatus: (): Promise<{
    lastBackupAt: string | null
    destination: string | null
    snoozedUntil: string | null
    installDate: string
    inProgress: boolean
  }> => ipcRenderer.invoke('backup:status'),
  runBackup: (chooseNewFolder?: boolean): Promise<{ destination: string; archivePath: string }> =>
    ipcRenderer.invoke('backup:run', { chooseNewFolder }),
  snoozeBackupReminder: (): Promise<void> => ipcRenderer.invoke('backup:snooze'),
  pickRestoreBackup: (): Promise<{ path: string; timestamp: string | null } | null> =>
    ipcRenderer.invoke('backup:pickRestoreFile'),
  restoreBackup: (backupPath: string): Promise<void> => ipcRenderer.invoke('backup:restore', { path: backupPath }),
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npm run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add client/electron/main.ts client/electron/preload.ts
git commit -m "feat(backup): wire backup/restore IPC handlers into the main process"
```

---

### Task 8: Settings page — Backup + Restore section

**Files:**
- Create: `client/src/features/settings/useBackupStatus.ts`
- Create: `client/src/features/settings/BackupSection.tsx`
- Modify: `client/src/features/settings/SettingsPage.tsx`
- Modify: `client/src/locales/pt-BR/settings.json`

**Interfaces:**
- Consumes: `window.girovest.getBackupStatus/runBackup/pickRestoreBackup/restoreBackup` (Task 7); `computeBackupReminderState` (Task 4).
- Produces: `useBackupStatus()` hook; `<BackupSection />` component, rendered from `SettingsPage.tsx` only when `typeof window.girovest !== 'undefined'`.

- [ ] **Step 1: Add the i18n strings**

```json
// client/src/locales/pt-BR/settings.json — new top-level "backup" key
  "backup": {
    "title": "Backup",
    "help": "Faça uma cópia dos dados da loja (clientes, produtos, contratos e fotos) em um lugar seguro, como um pendrive ou uma pasta sincronizada na nuvem.",
    "lastBackup": {
      "never": "Nunca feito",
      "daysAgo": "Há {{count}} dia",
      "daysAgo_other": "Há {{count}} dias"
    },
    "destination": "Destino: {{path}}",
    "noDestination": "Nenhum destino escolhido ainda.",
    "runNow": "Fazer backup agora",
    "runningNow": "Fazendo backup...",
    "chooseFolder": "Escolher outra pasta",
    "success": "Backup concluído em {{destination}}.",
    "error": "Não foi possível concluir o backup.",
    "restore": {
      "title": "Restaurar backup",
      "help": "Substitui TODOS os dados atuais pelos dados de um backup anterior. O aplicativo será reiniciado.",
      "action": "Restaurar backup...",
      "confirmTitle": "Restaurar backup de {{date}}?",
      "confirmMessage": "Isso substitui TODOS os dados atuais pelos dados do backup de {{date}}. Essa ação não pode ser desfeita.",
      "confirmAction": "Restaurar e reiniciar",
      "cancel": "Cancelar",
      "error": "Não foi possível restaurar o backup.",
      "unknownDate": "data desconhecida"
    }
  },
```

(Added as a sibling of the existing `"install"` and `"tours"` keys.)

- [ ] **Step 2: Write `useBackupStatus.ts`**

```typescript
// client/src/features/settings/useBackupStatus.ts
import { useCallback, useEffect, useState } from 'react'

export interface BackupStatus {
  lastBackupAt: string | null
  destination: string | null
  snoozedUntil: string | null
  installDate: string
  inProgress: boolean
}

type BackupBridge = {
  getBackupStatus?: () => Promise<BackupStatus>
}

// Polled, not fetch-once: `inProgress` exists specifically so a backup
// started from one surface (e.g. the Dashboard banner) disables the other
// (e.g. Settings' "Back up now" button) without the user having to
// navigate away and back. A mount-only fetch would only ever reflect
// whichever surface happened to render first. 5s is frequent enough that
// the two surfaces feel synchronized without meaningfully polling a local
// IPC call.
const POLL_INTERVAL_MS = 5_000

// Desktop only: mirrors useInstallId's window.girovest-optional-chaining
// pattern. Returns null on the hosted web build, where there is no
// installation to have a backup status.
export function useBackupStatus(): { status: BackupStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<BackupStatus | null>(null)

  const refresh = useCallback(() => {
    const bridge = (window as Window & { girovest?: BackupBridge }).girovest
    if (bridge?.getBackupStatus == null) return
    void bridge.getBackupStatus().then(setStatus).catch(() => undefined)
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refresh])

  return { status, refresh }
}
```

- [ ] **Step 3: Write `BackupSection.tsx`**

```tsx
// client/src/features/settings/BackupSection.tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { ConfirmDialog } from '../../components/ui/confirm-dialog.tsx'
import { showErrorToast, showSuccessToast } from '../../lib/toast.ts'
import { apiFetch } from '../../lib/api.ts'
import { useBackupStatus } from './useBackupStatus.ts'

type FullBridge = {
  runBackup?: (chooseNewFolder?: boolean) => Promise<{ destination: string; archivePath: string }>
  pickRestoreBackup?: () => Promise<{ path: string; timestamp: string | null } | null>
  restoreBackup?: (backupPath: string) => Promise<void>
}

function bridge(): FullBridge {
  return (window as Window & { girovest?: FullBridge }).girovest ?? {}
}

export function BackupSection() {
  const { t } = useTranslation('settings')
  const { status, refresh } = useBackupStatus()
  const [isRunning, setIsRunning] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [pendingRestore, setPendingRestore] = useState<{ path: string; timestamp: string | null } | null>(
    null,
  )

  async function runBackup(chooseNewFolder: boolean) {
    setIsRunning(true)
    try {
      // The renderer holds the auth token, so it — not the Electron main
      // process — is what can call this route: it must produce a fresh,
      // consistent database snapshot before the archive step, every time.
      // See the design doc's "Data consistency" section and
      // manualBackupActions.ts's runManualBackup, which now refuses to run
      // at all if this step was skipped.
      await apiFetch('/api/backup/snapshot', { method: 'POST' })
      const result = await bridge().runBackup?.(chooseNewFolder)
      if (result) showSuccessToast(t('backup.success', { destination: result.destination }))
      refresh()
    } catch {
      showErrorToast(t('backup.error'))
    } finally {
      setIsRunning(false)
    }
  }

  async function pickRestore() {
    try {
      const picked = await bridge().pickRestoreBackup?.()
      if (picked) setPendingRestore(picked)
    } catch {
      showErrorToast(t('backup.restore.error'))
    }
  }

  async function confirmRestore() {
    if (!pendingRestore) return
    setIsRestoring(true)
    try {
      await bridge().restoreBackup?.(pendingRestore.path)
      // On success the main process relaunches the app; this line only
      // runs if that failed before reaching the relaunch.
    } catch {
      showErrorToast(t('backup.restore.error'))
    } finally {
      setIsRestoring(false)
      setPendingRestore(null)
    }
  }

  if (status === null) return null

  const restoreDate = pendingRestore?.timestamp ?? t('backup.restore.unknownDate')
  // t()'s count-based pluralization (backup.lastBackup.daysAgo /
  // backup.lastBackup.daysAgo_other in the JSON) needs the actual day
  // count, not a pre-formatted string — this app is pt-BR only and has no
  // other localized relative-time formatter already in use (client/src/
  // lib/date.ts wraps Intl.DateTimeFormat for calendar dates, not relative
  // ones), so compute it directly rather than reaching for a new library.
  const daysSinceBackup =
    status.lastBackupAt === null
      ? null
      : Math.floor((Date.now() - new Date(status.lastBackupAt).getTime()) / (24 * 60 * 60 * 1000))

  return (
    <div className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
      <span className="text-sm font-medium">{t('backup.title')}</span>
      <p className="text-sm text-muted-foreground">{t('backup.help')}</p>
      <p className="text-sm">
        {status.lastBackupAt === null
          ? t('backup.lastBackup.never')
          : t('backup.lastBackup.daysAgo', { count: daysSinceBackup })}
      </p>
      <p className="text-sm text-muted-foreground">
        {status.destination ? t('backup.destination', { path: status.destination }) : t('backup.noDestination')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={isRunning || status.inProgress} onClick={() => runBackup(false)}>
          {isRunning || status.inProgress ? t('backup.runningNow') : t('backup.runNow')}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={isRunning} onClick={() => runBackup(true)}>
          {t('backup.chooseFolder')}
        </Button>
      </div>
      <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-sm font-medium">{t('backup.restore.title')}</span>
        <p className="text-sm text-muted-foreground">{t('backup.restore.help')}</p>
        <Button type="button" variant="secondary" size="sm" onClick={pickRestore}>
          {t('backup.restore.action')}
        </Button>
      </div>
      <ConfirmDialog
        open={pendingRestore !== null}
        title={t('backup.restore.confirmTitle', { date: restoreDate })}
        message={t('backup.restore.confirmMessage', { date: restoreDate })}
        confirmLabel={t('backup.restore.confirmAction')}
        cancelLabel={t('backup.restore.cancel')}
        confirmVariant="danger"
        confirmDisabled={isRestoring}
        onConfirm={confirmRestore}
        onCancel={() => setPendingRestore(null)}
      />
    </div>
  )
}
```

- [ ] **Step 4: Render it from `SettingsPage.tsx`**

Add the import:

```typescript
import { BackupSection } from './BackupSection.tsx'
```

Add, alongside the existing `installId !== null` and tours blocks (same electron-gated placement, outside the `<form>`). A bare `window.girovest` reference doesn't typecheck — no global `.d.ts` declares it anywhere in this codebase — so cast the same way every other `window.girovest` consumer already does (see `useInstallId.ts`):

```tsx
        {typeof (window as Window & { girovest?: unknown }).girovest !== 'undefined' && <BackupSection />}
```

- [ ] **Step 5: Typecheck**

Run: `cd client && npm run typecheck`
Expected: no errors

- [ ] **Step 6: Manual verification**

Run: `cd client && npm run electron:dev`
- Open Settings. Confirm the Backup section renders with "Nunca feito" and no destination.
- Click "Fazer backup agora," pick a folder. Confirm success toast, and that "Last backup" updates.
- Click again — confirm it reuses the same folder (no dialog).
- Click "Restaurar backup...", pick the `.zip` just created, confirm the dialog shows the right date, cancel it (do not actually restore yet — full restore is verified end-to-end in Task 11).

- [ ] **Step 7: Commit**

```bash
git add client/src/features/settings/useBackupStatus.ts client/src/features/settings/BackupSection.tsx client/src/features/settings/SettingsPage.tsx client/src/locales/pt-BR/settings.json
git commit -m "feat(backup): add Settings page backup and restore UI"
```

---

### Task 9: Dashboard reminder banner

**Files:**
- Create: `client/src/features/dashboard/BackupReminderBanner.tsx`
- Modify: `client/src/features/dashboard/DashboardPage.tsx`
- Modify: `client/src/locales/pt-BR/dashboard.json`

**Interfaces:**
- Consumes: `useBackupStatus` (Task 8), `computeBackupReminderState` (Task 4).
- Produces: `<BackupReminderBanner />`.

- [ ] **Step 1: Add the i18n strings**

```json
// client/src/locales/pt-BR/dashboard.json — new "backupReminder" key
  "backupReminder": {
    "neverBackedUp": "Você ainda não fez backup dos dados — já se passaram {{count}} dia desde a configuração.",
    "neverBackedUp_other": "Você ainda não fez backup dos dados — já se passaram {{count}} dias desde a configuração.",
    "overdue": "Já se passaram {{count}} dia desde o último backup.",
    "overdue_other": "Já se passaram {{count}} dias desde o último backup.",
    "backUpNow": "Fazer backup agora",
    "backingUpNow": "Fazendo backup...",
    "remindLater": "Lembrar depois",
    "error": "Não foi possível concluir o backup."
  }
```

- [ ] **Step 2: Write `BackupReminderBanner.tsx`**

```tsx
// client/src/features/dashboard/BackupReminderBanner.tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Button } from '../../components/ui/button.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { apiFetch } from '../../lib/api.ts'
import { computeBackupReminderState, BACKUP_GRACE_DAYS } from '../../lib/backupReminder.ts'
import { useBackupStatus } from '../settings/useBackupStatus.ts'

type BackupBridge = {
  runBackup?: (chooseNewFolder?: boolean) => Promise<unknown>
  snoozeBackupReminder?: () => Promise<void>
}

function bridge(): BackupBridge {
  return (window as Window & { girovest?: BackupBridge }).girovest ?? {}
}

export function BackupReminderBanner() {
  const { t } = useTranslation('dashboard')
  const { status, refresh } = useBackupStatus()
  const [isRunning, setIsRunning] = useState(false)

  if (typeof (window as Window & { girovest?: unknown }).girovest === 'undefined' || status === null) return null

  const state = computeBackupReminderState(
    { lastBackupAt: status.lastBackupAt, installDate: status.installDate, snoozedUntil: status.snoozedUntil },
    new Date(),
  )
  if (!state.overdue) return null

  const days = state.daysOverdue + BACKUP_GRACE_DAYS

  async function backUpNow() {
    setIsRunning(true)
    try {
      // Same reason as BackupSection's identical call: only the renderer
      // holds the auth token needed to produce a fresh snapshot before the
      // archive step.
      await apiFetch('/api/backup/snapshot', { method: 'POST' })
      await bridge().runBackup?.(false)
      refresh()
    } catch {
      showErrorToast(t('backupReminder.error'))
    } finally {
      setIsRunning(false)
    }
  }

  async function remindLater() {
    try {
      await bridge().snoozeBackupReminder?.()
      refresh()
    } catch {
      showErrorToast(t('backupReminder.error'))
    }
  }

  return (
    <Card className="mb-4 flex-shrink-0 border-destructive/30 bg-destructive-subtle">
      <CardBody className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-destructive-subtle-foreground">
          <AlertTriangle size={16} />
          {t(state.neverBackedUp ? 'backupReminder.neverBackedUp' : 'backupReminder.overdue', { count: days })}
        </div>
        <div className="flex flex-shrink-0 gap-2">
          <Button size="sm" disabled={isRunning} onClick={backUpNow}>
            {isRunning ? t('backupReminder.backingUpNow') : t('backupReminder.backUpNow')}
          </Button>
          <Button variant="secondary" size="sm" disabled={isRunning} onClick={remindLater}>
            {t('backupReminder.remindLater')}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
```

- [ ] **Step 3: Render it from `DashboardPage.tsx`**

Add the import:

```typescript
import { BackupReminderBanner } from './BackupReminderBanner.tsx'
```

Add as the first child inside the page's root `<div>`, before the `<h1>`:

```tsx
      <BackupReminderBanner />
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npm run typecheck`
Expected: no errors

- [ ] **Step 5: Manual verification**

Run: `cd client && npm run electron:dev`
- With no backup yet and a fresh install, confirm the banner does NOT show (inside the 30-day grace period).
- Temporarily edit `client/electron/manualBackup.ts`'s `resolveInstallDate` return value (or hand-edit the `install-id` file's mtime with `touch -d "40 days ago"`) to simulate an old install, restart the app, confirm the banner shows with the "never backed up" copy.
- Click "Fazer backup agora" from the banner, confirm it disappears after a successful backup.
- Simulate overdue again, click "Lembrar depois," confirm the banner disappears and does not reappear until manually clearing `backup-reminder-snoozed-until` in `userData` (or waiting out the 3-day snooze).
- Revert any temporary edits made for this manual test.

- [ ] **Step 6: Commit**

```bash
git add client/src/features/dashboard/BackupReminderBanner.tsx client/src/features/dashboard/DashboardPage.tsx client/src/locales/pt-BR/dashboard.json
git commit -m "feat(backup): add dashboard overdue-backup reminder banner"
```

---

### Task 10: Full test suite + release checklist entry

**Files:**
- Modify: `docs/release-checklist.md`

- [ ] **Step 1: Run the full client and server test suites**

```bash
cd client && npm test
cd ../server && npm test
```

Expected: all tests pass, including every new file from Tasks 1–6.

- [ ] **Step 2: Typecheck both workspaces**

```bash
cd client && npm run typecheck
cd ../server && npx tsc -p tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Add the manual verification step to the release checklist**

Read `docs/release-checklist.md` first to match its existing format, then add a step (in the pre-release manual-verification section) covering:

```markdown
- [ ] Backup & restore: in a packaged build, run "Fazer backup agora" to an
  external folder (confirm the `.zip` appears with today's timestamp,
  containing `dev.db` and `product-photos/`), add a new client, then use
  "Restaurar backup..." to restore that backup and confirm the new client is
  gone and the app relaunches cleanly. Also confirm pruning: after 6 backups
  to the same folder, only the 5 most recent remain and any unrelated files
  already in that folder are untouched.
```

- [ ] **Step 4: Commit**

```bash
git add docs/release-checklist.md
git commit -m "docs: add backup/restore manual verification to the release checklist"
```

---

## Self-Review

**Spec coverage:**
- Electron-only scope, synchronous `window.girovest` gate → Task 8/9 (`typeof window.girovest !== 'undefined'`).
- Single zip archive per backup → Task 1 (`archive.ts`), Task 6 (`runManualBackup`).
- Live-database consistency via `better-sqlite3` online backup → Task 5.
- Retention (5, name-filtered, timestamp-sorted) → Task 3 (`pruneExternalBackups`).
- Atomicity (`.partial` → rename, stale-partial sweep) → Task 3 + Task 6.
- Pre-flight free-space check → Task 6 (`estimateFreeBytes`/`estimateSourceBytes` in `runManualBackup`).
- Destination memory + identity verification, persisted at pick time → Task 3 (`verifyDestination`/`claimDestination`) + Task 6.
- Last-backup tracking, trimmed markers → Task 3.
- Grace period off `install-id`'s birthtime (with mtime fallback) → Task 3 (`resolveInstallDate`).
- Reminder due-calculation, never-backed-up vs. overdue distinction → Task 4.
- No permanent snooze opt-out → Task 4/9 (snooze always re-expires; no such control exists in the UI).
- Restore (pick → confirm → stop server → extract-to-temp-then-swap → sidecar cleanup → relaunch) → Task 6 (`runManualRestore`) + Task 7 (`backup:restore`).
- Known accepted risk (older app restoring a newer backup) → not solved, as designed; nothing in the plan attempts schema-version checking.
- IPC surface (`backup:status/run/snooze/pickRestoreFile/restore`), correct placement (`activation:retry` template, closing over `win`) → Task 7.
- Concurrency guard → Task 7 (`backupRunPromise`).
- Performance (off-main-thread archiving) → Task 2 (spawned worker process).
- i18n (Settings + Dashboard, two distinct banner strings) → Task 8/9.
- Manual verification per the release checklist → Task 10.

**Placeholder scan:** no TBD/TODO; every step has literal code or an exact shell command.

**Type consistency:** `ArchiveSource` defined once in Task 1, imported (not redefined) everywhere else. `RunManualBackupResult`/`RunManualBackupDeps`/`RunManualRestoreDeps` defined once in Task 6, imported into Task 7. `BackupStatus` shape matches the `backup:status` handler's return value (Task 7) exactly in `useBackupStatus.ts` (Task 8) and `BackupReminderBanner.tsx` (Task 9). `computeBackupReminderState`'s input shape (`BackupReminderStatus`) matches what both consumers pass from `BackupStatus`.

---

Plan complete and saved to `docs/superpowers/plans/2026-07-31-offline-backup-reminder.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
