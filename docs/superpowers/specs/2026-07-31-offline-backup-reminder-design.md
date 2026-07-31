# Offline Backup Reminder — Design

Date: 2026-07-31
Status: Draft

## Goal

Girovest (Electron build) stores everything — clients, products, contracts,
allocations, product photos — in a single SQLite file plus a photos folder
inside the OS's per-user app-data directory. Nothing ever leaves that disk.
The app already copies `dev.db` into `userData/backups/<oldVersion>/` before
running migrations (`client/electron/backup.ts`), but that copy sits right
next to the live data — a lost, stolen, or failed machine takes the "backup"
down with it. As the shop's data grows into the thousands of entries, that is
an unacceptable single point of failure.

This closes the gap flagged in
`docs/superpowers/specs/2026-07-30-commercialization-design.md`
("Customers without the backup add-on still get a safety net... a manual
one-click export"): a built-in way to copy the shop's data to a place the
owner controls (USB drive, cloud-synced folder, network share), plus a
reminder that nags until it's actually been done.

## Scope

Electron desktop build only, gated by a synchronous `typeof window.girovest
!== 'undefined'` check — not the same thing as `SettingsPage.tsx`'s existing
`installId !== null` (that's the resolved value of an async IPC round trip
via `useInstallId`, which is `null` until it resolves, so a section gated on
it can pop in after mount). Both the Settings "Backup" section and the
Dashboard banner use the synchronous check directly, so they agree from the
first render and neither needs to handle a "still loading" state for
visibility. The hosted website build shows nothing: its data lives on the
server, is a separate concern, and a browser can't write an arbitrary folder
structure to disk the way a native dialog can.

## What gets backed up

A single compressed archive containing:
- A consistent snapshot of `dev.db`, taken via the online-backup mechanism
  described under Data consistency below — a single self-contained file, not
  the raw `dev.db` plus `dev.db-*` sidecars (`-wal`, `-journal`, `-shm`) that
  `backupDatabaseIfNeeded` collects; that file set is only safe to copy
  as-is when nothing has the database open, which isn't true here (see Data
  consistency).
- The `product-photos` folder in full.

written as one file into a parent folder the user picks:
`<chosen-parent>/girovest-backup-<YYYY-MM-DD-HHmmss>.zip` — a full timestamp,
not just a date, so two backups on the same day (a completely normal case:
back up, add a contract, back up again before leaving) never collide or
overwrite each other.

One archive file (not a folder of loose files) matters for two reasons
beyond tidiness: product-photos can hold thousands of small image files, and
copying/syncing that many individually to removable media or a cloud-synced
folder is slow and — for cloud-synced destinations — risks the destination
being read mid-sync (a restore attempt could pick up a folder with some
files still missing). A single file is copied or synced as one atomic-ish
unit.

The exact zip library (e.g. a pure-JS archiver/extractor with no native
bindings, to stay consistent with this app's general avoidance of native
deps outside `bcrypt`/`better-sqlite3` — see the bundling note in
`client/electron/main.ts`'s `resolveServerEntry` comment) is an
implementation-plan decision, not a design one — not guessing a specific
package/version here.

## Data consistency: this is a hot copy of a live database

`backupDatabaseIfNeeded` (`client/electron/backup.ts`) is safe to implement
as a raw file copy only because of *when* it runs: `main.ts` calls it before
`serverProcess` is spawned (`main.ts:280` vs `:301`), so nothing has `dev.db`
open yet. The manual "Back up now" action is fundamentally different — it
runs while the server is live, mid-shift, possibly mid-write. `dev.db-wal`
already appears as a real sidecar in `backup.test.ts`'s fixtures, confirming
WAL mode is in use. A plain `fs.copyFile`/`fs.cp` of `dev.db` plus its `-wal`
sidecar while a connection is actively writing can capture the two files at
inconsistent points relative to each other — a copy that looks complete but
is not internally consistent. A backup feature that can silently produce a
corrupt snapshot is worse than no backup feature.

`better-sqlite3` (the driver Prisma's `@prisma/adapter-better-sqlite3` wraps,
per `server/src/db/client.ts`) has a built-in **online backup API** for
exactly this: `db.backup(destination)` returns a promise, is safe to run
against a database that's actively in use, and — per its own docs —
transparently restarts the transfer if a concurrent write lands mid-copy,
rather than producing a torn file. This is the mechanism to use; a raw
filesystem copy of a live `dev.db` is not an acceptable substitute.

Practically, that means the snapshot step has to happen in the process that
owns the live connection — the **server**, not the Electron main process
(which also avoids needing `better-sqlite3` rebuilt against Electron's Node
ABI just for this, on top of the server's existing one). Two new pieces:

- A new authenticated server route, e.g. `POST /api/backup/snapshot`
  (behind `requireAuth`, same as every other router —
  `server/src/routes/clients.ts:9`, `products.ts:25`), that opens a
  short-lived `better-sqlite3` connection to the live `dev.db` and calls
  `.backup()` into a staging path inside `userData` (e.g.
  `userData/backup-staging/dev.db`), then responds once the transfer
  completes.
- The renderer — already authenticated, already calling the server via
  `apiFetch` (`client/src/lib/api.ts`) — calls this route first, then invokes
  the existing `backup:run` Electron IPC handler, which zips the staged
  `dev.db` (no separate `-wal`/`-journal` sidecars needed: an online backup
  produces one self-contained consistent file) together with
  `product-photos/` into the destination archive, and clears the staging
  file afterward regardless of outcome.

This route only exists for the Electron build's own local server and is not
reachable from the hosted website's server the same way (no Electron
frontend calling it there); it's dead code on that deployment path in the
same sense any Electron-only client feature is, which is an accepted
trade-off already true of other Electron-only surfaces in this codebase.

## Retention

`pruneBackups()` (`client/electron/backup.ts`) keeps the N most-recently-
modified *subdirectories* of a folder, by `entry.isDirectory()`, with no name
filter — safe today only because it's pointed at `userData/backups/`, a
folder the app owns exclusively. The external destination is a folder the
*user* picks (a USB root, `Documents`, a synced cloud folder) that can
already contain unrelated files and folders of the user's own. Reusing
`pruneBackups()` unchanged against it would delete the user's own content
once that folder holds 6+ subdirectories total. The implementation needs an
equivalent that:
- only ever considers entries matching the app's own naming
  (`girovest-backup-*.zip`) — everything else in that folder is left alone,
  always;
- sorts by the timestamp encoded in the filename, not filesystem mtime —
  mtime is unreliable on the exact media this targets (FAT32's 2-second
  mtime resolution, and cloud-sync clients that rewrite mtimes on their own
  schedule during sync);
- prunes past `MAX_BACKUPS` (5), same constant, reused for consistency with
  the internal mechanism — though note under Known limitations below that
  this bounds *count*, not disk usage, given `product-photos` can be large.

Whether this is a parameterized `pruneBackups()` or a sibling function is an
implementation-plan detail; the filtering and sort-key behavior above are
the design requirement, not optional.

**Atomicity.** A backup that fails partway (disk full on a USB stick is the
single most likely real-world failure here) must never leave a half-written
archive that looks complete. Write to a staging name inside the destination
folder (e.g. `.girovest-backup-<timestamp>.zip.partial`) and rename to the
final `girovest-backup-<timestamp>.zip` only after the last byte is flushed.
A stale `.partial` file from a previous crashed run is swept (deleted, not
counted as a backup) at the start of the next attempt. Pruning only ever
looks at fully-named `girovest-backup-*.zip` files, so a `.partial` can never
occupy one of the 5 retained slots.

**Pre-flight space check.** Before starting, compare the estimated archive
size (source `dev.db` size + `product-photos` folder size, as a rough upper
bound — actual zip output will usually be smaller) against free space on the
destination volume, and fail fast with a clear message rather than after
several minutes of copying.

## Destination memory

The chosen parent folder path is remembered in a new local marker file in
`userData` (`backup-destination`, plain text path — trimmed on read, unlike
`db-backup-version`; see `installId.ts`'s documented reasoning for why an
untrimmed path/id read back from a hand-edited or newline-appended file is a
real, previously-hit failure mode). The path is persisted **as soon as it's
picked**, not only after a successful backup — otherwise a failed first
backup to a newly-chosen folder leaves the old (already-known-bad) path as
"remembered," and the next click repeats the same failure indefinitely.

Reachability is checked by more than `existsSync`, which passes for a stale
mount point on Linux or a different drive that was reassigned the same
letter on Windows. On first use of a folder, write a small hidden identity
file into it (e.g. `.girovest-backup-destination` containing the install id
from `installId.ts`) and verify its presence/content on every reuse; treat a
missing or mismatched identity file as "not this destination anymore" and
require the user to confirm or re-pick, so pruning (which trusts a folder is
"ours") is never applied to a folder that merely happens to share a path.

"Back up now" reuses the remembered destination with one click when it
checks out. If it doesn't — unreachable, missing/mismatched identity file,
or a write actually fails — show one error toast and stop; do not
auto-open the folder picker as a side effect of that error (a modal
appearing right after a toast, with no click in between, is a surprise, not
a convenience). The user's next explicit click ("Back up now" again, or
"Choose a different folder") is what opens the picker. Settings displays the
remembered path and offers "Choose a different folder" to change it anytime,
independent of whether the current one still checks out.

## Last-backup tracking

A new local marker file in `userData` (`last-manual-backup-at`, ISO
timestamp) is written only after a fully successful copy — never on a
partial or failed one. Deliberately separate from `db-backup-version`, which
tracks the unrelated pre-migration safety-copy mechanism.

## Grace period (avoid nagging on day one)

The 30-day reminder clock should not start at bare install — a shop that
just installed the app to try it out has nothing worth backing up yet.

An earlier version of this design proposed a new backend endpoint
(`GET /api/backup/has-data`, a `SELECT EXISTS` across clients/products/
contracts) plus a new local `first-data-seen-at` marker to approximate "when
did real data first appear." That's disproportionate for what's admittedly
just an approximation either way (a shop upgrading from an older version
with a year of existing data would still start the clock from whenever this
feature first runs, not their real first entry) — and it's the only part of
an otherwise Electron-only feature that would touch the server at all,
shipping an endpoint that's dead code on the hosted web build.

Simpler equivalent, zero new backend surface: `install-id`
(`client/electron/installId.ts`) is written exactly once, at first launch,
and — like `userData` generally — survives in-place updates. Its file
birthtime (`fs.statSync(idPath).birthtime`) is a serviceable stand-in for
"how long has this installation existed," available for free from a file the
app already creates. The 30-day clock runs from
`last-manual-backup-at ?? installIdFileBirthtime`; if `last-manual-backup-at`
is unset, the reminder can't fire until the install itself is at least 30
days old, which satisfies the "don't nag day one" requirement without a new
marker or endpoint.

## Reminder UI

**Settings page** (`client/src/features/settings/SettingsPage.tsx`), new
"Backup" section, same electron-gated pattern as the existing install-id
block:
- Last backup time ("12 days ago" / "Never").
- Remembered destination path, if any.
- "Back up now" (uses remembered destination, or opens the picker if none
  set) / "Choose a different folder" buttons.

**Dashboard banner**, shown when `daysOverdue > 30` (days since
`last-manual-backup-at ?? installIdFileBirthtime`, per the grace-period rule
above) and not currently snoozed. Two distinct strings, not one, because
"since your last backup" is false when there hasn't been one yet:
- Never backed up: "You haven't backed up your data yet — it's been N days
  since setup. [Back up now] [Remind me later]"
- Overdue: "It's been N days since your last backup. [Back up now]
  [Remind me later]"

"Remind me later" writes a third local marker,
`backup-reminder-snoozed-until` (ISO timestamp, now + 3 days), and hides the
banner until that date even if still overdue. A successful backup clears the
snooze marker along with updating `last-manual-backup-at`.

**No permanent opt-out.** Snoozing repeats indefinitely (overdue → snooze 3
days → overdue again) with no escalation and no "stop asking forever"
option. This is a deliberate choice, not an oversight: the premise of this
whole feature (per the original ask) is that an unmade backup is genuinely
dangerous at this app's data scale, and a one-click permanent silence
defeats that on the first annoyed click. A shop owner who backs up through
some other means entirely still just clicks "Back up now" occasionally to
keep the marker current, or, worst case, keeps snoozing every few days —
mild friction is the accepted cost here.

## Restore

**Settings page**, new "Restore from backup..." action alongside the backup
controls. Flow:
1. Native file picker (not folder picker — the backup is now a single
   `.zip`) scoped to `.zip` files, defaulting to the remembered destination
   folder if set.
2. A destructive-action confirmation naming the backup's date: "This
   replaces ALL current data with the backup from `<date>`. This cannot be
   undone. Continue?" — matching the weight of other destructive confirms
   already in the app (e.g. `client/src/components/ui/confirm-dialog.tsx`).
3. On confirm: stop the running `serverProcess` (main.ts already tracks and
   kills it elsewhere, e.g. on quit — same primitive, not a new one), remove
   the current `dev.db-wal`/`dev.db-journal`/`dev.db-shm` sidecars if any
   (the archive's `dev.db` is a sidecar-free snapshot — stale sidecars left
   over from the just-stopped live database must not linger and get
   replayed against the newly restored file), extract the archive's
   `dev.db` over the current one and `product-photos/` over the current
   folder, then `app.relaunch()` +
   `app.exit()` — the same pattern the auto-updater already uses to restart
   into a fresh process (`client/electron/updater.ts`). Relaunching (instead
   of just restarting the child server process) means the restored data goes
   through the exact same boot sequence as any normal launch — migrations
   (`resolveMigrateEntry`), the pre-migration safety backup
   (`backupDatabaseIfNeeded`), and marker bookkeeping all run unmodified
   against the restored files, rather than needing a second, parallel
   "boot after restore" code path.

**Known accepted risk**: a backup made by a newer app version, restored into
an older installed version, could contain schema fields the older app
doesn't know about — restoring forward (older backup → newer app) is safe
via normal migrations; restoring backward is not handled specially. Given
this app auto-updates (`client/electron/updater.ts`), this is expected to be
rare in practice and is not solved by this design.

## Error handling

Any failure mid-backup or mid-restore (disk full, drive unplugged,
permission denied, corrupt/foreign archive on restore) shows an error toast
and leaves existing state untouched:
- Backup failure: `last-manual-backup-at` and the snooze marker are only
  ever updated *after* the archive has been fully written and renamed from
  its `.partial` name (see Atomicity, under Retention) — so a failure before
  that point leaves both markers exactly as they were. Pruning runs only
  after that same rename succeeds, and only ever targets fully-named
  `girovest-backup-*.zip` files, never the new one that just failed. If
  pruning itself then fails (e.g. `ENOENT` because the destination
  disappeared between the write and the prune — `pruneBackups` today
  surfaces this as a thrown error, `backup.ts:62`), that failure is logged
  but does not retroactively mark the backup as failed: the archive that was
  actually written is real and complete, a stale copy sitting past the
  retention count is a cosmetic problem, not a correctness one.
- Restore failure (during extraction, before the relaunch step): the live
  `dev.db`/`dev.db-*`/`product-photos` are untouched and the server process
  is restarted normally — extraction writes to a temp location first and
  only swaps it into place once the archive is confirmed fully valid and
  extracted, so a bad archive can never leave the app with a half-replaced,
  unbootable database.

## Known limitations (accepted, not solved by this design)

- **Single destination, not the 3-2-1 rule.** Standard backup doctrine wants
  multiple independent copies across at least two media types with one
  off-site. This feature supports exactly one remembered destination at a
  time. Given the target audience (a small shop, not an IT department), one
  destination the owner actually uses beats a multi-destination feature
  they find confusing and skip. A user can still manually maintain a second
  copy by choosing a different folder occasionally ("Choose a different
  folder"), just not automatically.
- **No encryption at rest.** The archive contains client names, phone
  numbers, contracts, and product photos, unencrypted, sitting whichever
  destination the user chose — including a cloud-synced folder, which
  hands the raw data to that provider's storage too. This mirrors the
  commercialization design's paid cloud-backup add-on being the one that
  gets "encrypted snapshot" treatment
  (`2026-07-30-commercialization-design.md`); this free, local, manual
  backup does not encrypt. Worth a short, honest line in the Settings copy
  ("stored as plain files — keep the destination itself private") rather
  than silence.
- **No source-integrity check before backing up.** This design does not run
  `PRAGMA integrity_check` or equivalent on `dev.db` before snapshotting —
  a corrupt live database would simply produce a corrupt (but structurally
  complete) backup. Out of scope; flag as a future addition if corruption
  is ever actually observed in the wild.
- **Restoring a newer backup into an older app version** is not specially
  handled (see Restore's "Known accepted risk").
- **Markers don't survive uninstall.** The NSIS uninstaller can remove
  `userData`, taking `last-manual-backup-at`, the destination marker, the
  snooze marker, and `install-id` with it — same as it already takes
  `dev.db` itself. A reinstall starts a fresh grace period with no
  backup history to reconcile, which is consistent with there being no data
  left to protect either.

## New IPC surface

Following the existing `contextBridge`/`ipcMain.handle` pattern
(`client/electron/preload.ts`, `client/electron/main.ts`). Registration
placement matters: `install:id` is registered at module scope before
`whenReady` and closes over nothing, which is the wrong template here —
`dialog.showOpenDialog` needs a parent `BrowserWindow` (on Windows, an
unparented dialog can open behind the app window). `activation:retry`
(`main.ts:539`) is the right template: registered inside `whenReady`, after
`createWindow`, closing over `win`. The new handlers below follow that one.

- `backup:status` (invoke) → `{ lastBackupAt: string | null, destination:
  string | null, snoozedUntil: string | null, installDate: string,
  inProgress: boolean }`. `installDate` is the `install-id` file's
  birthtime (see Grace period); `inProgress` reflects the concurrency guard
  below. This is the one payload both the Settings section and the
  Dashboard banner read — the overdue calculation is a pure function of
  this payload plus "now," so it's testable without touching Electron (see
  Testing).
- `backup:run` (invoke, optional `{ chooseNewFolder: boolean }`) → if
  another run is already in flight, returns that same in-flight promise
  rather than starting a second one (see Concurrency below). Otherwise:
  resolves the destination (remembered + verified, or opens the folder
  picker per the Destination memory rules above), calls the new
  `POST /api/backup/snapshot` server route, zips the staged snapshot +
  `product-photos` to a `.partial` file and renames it, updates markers and
  prunes on success, clears the staging file regardless of outcome, and
  returns the result or throws for the renderer to toast. Runs off the main
  thread's synchronous path — see Performance below.
- `backup:snooze` (invoke) → writes the snooze marker.
- `backup:restore` (invoke) → runs the `.zip` file picker, confirms
  destructively in the renderer before invoking, then on confirm performs
  the stop-server → extract-to-temp → swap → relaunch sequence described
  under Restore. Throws (without relaunching) on any failure before the
  swap step, for the renderer to toast.

**Concurrency.** The Settings page and the Dashboard banner both expose
"Back up now," and both call `backup:run`. Without a guard, two clicks (one
from each surface, or a double-click) start two copies writing into the
same destination concurrently. A module-level in-flight promise in main
makes a second call while one is running return the first call's promise
instead of starting a new one; both UIs also render a disabled/pending state
driven by `backup:status`'s `inProgress` field.

**Performance.** `backup.ts` today is entirely synchronous, which is safe
only because it runs before any window exists. A multi-gigabyte zip over
USB 2.0 is minutes of work; running it synchronously on the main process
freezes the entire app (no repaint, no IPC, the "unresponsive" watchdog
firing) for that whole time. Model this on `runMigrations`
(`main.ts:131-159`) — a promise-wrapped async operation the main process
awaits without blocking its event loop — not on `backup.ts`'s current
synchronous style. Both UIs show a pending/progress state for the duration.

## Testing

- Unit tests for the new marker read/write helpers (including the `trim()`
  behavior on the destination marker), the prune-by-name-glob-and-parsed-
  timestamp logic (not mtime), and the `.partial` → final rename flow,
  following the existing style in `client/electron/backup.test.ts` (temp
  dirs via `fs.mkdtempSync`, no real filesystem outside a scratch dir).
  Explicitly test that pruning never touches a file that doesn't match the
  `girovest-backup-*.zip` name pattern (the collateral-damage case).
- Unit tests for the reminder-due calculation (grace period off
  `install-id`'s birthtime, snooze, the never-backed-up vs. overdue
  distinction, overdue thresholds) as a pure function of the `backup:status`
  payload shape and "now", so it doesn't depend on real time or Electron.
- Unit test for the concurrency guard: a second `backup:run` call while one
  is in flight returns the same promise rather than starting a second copy.
- Unit tests for the new `POST /api/backup/snapshot` server route: requires
  auth (401 without a token, matching every other route's convention), and
  produces a valid, openable snapshot file via `better-sqlite3`'s
  `.backup()`.
- Unit tests for restore: archive-to-temp-then-swap round-trips correctly,
  a corrupt/truncated archive leaves the original `dev.db`/`product-photos`
  untouched, and the extract step never writes directly into the live
  location before validation.
- No new automated coverage for the native file/folder-picker dialogs or the
  actual `app.relaunch()` (not meaningfully testable outside a real OS/real
  app process); manual verification of the full backup → restore round trip,
  including on a destination folder containing unrelated pre-existing files
  (to verify they survive pruning), in a packaged build per
  `docs/release-checklist.md`.

## i18n

New strings under the `settings` namespace (Backup and Restore sections,
including the destructive-restore confirmation copy and the two distinct
banner strings — never-backed-up vs. overdue) in
`client/src/locales/pt-BR/settings.json`, plus the dashboard banner strings
in `client/src/locales/pt-BR/dashboard.json` — the only locale this app
ships today — following the current `t('...')` pattern seen throughout
`SettingsPage.tsx`.
