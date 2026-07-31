# Offline Backup Reminder — Design

Date: 2026-07-31
Status: Approved

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

Electron desktop build only, gated the same way `installId` already is —
presence of `window.girovest` (see `client/electron/preload.ts`,
`client/src/features/settings/SettingsPage.tsx`'s `installId !== null` block).
The hosted website build shows nothing: its data lives on the server, is a
separate concern, and a browser can't write an arbitrary folder structure to
disk the way a native dialog can.

## What gets backed up

A full copy of:
- `dev.db` plus any `dev.db-*` sidecars (`-wal`, `-journal`, `-shm`) — same
  file set `backupDatabaseIfNeeded` already collects.
- The `product-photos` folder in full.

into a timestamped subfolder of a parent folder the user picks:
`<chosen-parent>/girovest-backup-<YYYY-MM-DD>/{dev.db, dev.db-*, product-photos/}`.

## Retention

`pruneBackups()` (`client/electron/backup.ts`) already does exactly the right
thing — keep the N most-recently-modified subdirectories of a folder, delete
the rest — for the internal upgrade-backup mechanism. Reuse it unchanged
against the external destination folder after each successful backup, capped
at `MAX_BACKUPS` (5). This bounds disk usage on external media without
losing the safety margin a single overwritten copy would have (one failed or
partial backup no longer destroys the only good copy).

## Destination memory

The chosen parent folder path is remembered in a new local marker file in
`userData` (`backup-destination`, plain text path — same pattern as
`db-backup-version`). "Back up now" reuses it with one click. If the
remembered path is unreachable (drive unplugged, folder deleted), the backup
attempt fails, surfaces an error toast, and falls back to opening the native
folder picker so the user can pick a destination (which becomes the new
remembered path on the next successful backup). Settings displays the
remembered path and offers a "Choose a different folder" action that opens
the picker on demand.

## Last-backup tracking

A new local marker file in `userData` (`last-manual-backup-at`, ISO
timestamp) is written only after a fully successful copy — never on a
partial or failed one. Deliberately separate from `db-backup-version`, which
tracks the unrelated pre-migration safety-copy mechanism.

## Grace period (first real data)

The 30-day reminder clock should not start at bare install — a shop that
just installed the app to try it out has nothing worth backing up yet. But
there's no existing signal for "first real data was entered": no create
endpoint currently stamps one, and hooking every entity-creation path
(clients, products, contracts, allocations) just for this would be invasive
for a cosmetic grace period.

Instead: one new lightweight backend check —
`SELECT EXISTS(...)`-style query across clients/products/contracts, exposed
as a small endpoint (e.g. `GET /api/backup/has-data`) — tells the client
whether the shop currently has any data. The first time the client observes
`hasData: true` with no `last-manual-backup-at` marker and no
`first-data-seen-at` marker yet, it writes `first-data-seen-at` (ISO
timestamp) locally. The 30-day clock runs from
`last-manual-backup-at ?? first-data-seen-at`; if neither exists yet, no
reminder shows.

This is a "first observed", not a true historical "first created" date — a
shop upgrading from an older version with a year of existing data starts the
clock from the upgrade, not their real first entry. That's an acceptable
approximation for a grace period whose only job is "don't nag day one."

## Reminder UI

**Settings page** (`client/src/features/settings/SettingsPage.tsx`), new
"Backup" section, same electron-gated pattern as the existing install-id
block:
- Last backup time ("12 days ago" / "Never").
- Remembered destination path, if any.
- "Back up now" (uses remembered destination, or opens the picker if none
  set) / "Choose a different folder" buttons.

**Dashboard banner**, shown when
`daysSinceLastBackup > 30` (measured per the grace-period rule above):
"It's been N days since your last backup — [Back up now] [Remind me later]".

"Remind me later" writes a third local marker,
`backup-reminder-snoozed-until` (ISO timestamp, now + 3 days), and hides the
banner until that date even if still overdue. A successful backup clears the
snooze marker along with updating `last-manual-backup-at`.

## Error handling

Any failure mid-copy (disk full, drive unplugged, permission denied) shows
an error toast and leaves `last-manual-backup-at`, the snooze marker, and
existing destination backups untouched — a failed attempt must never look
like a successful one, and must never trigger pruning.

## New IPC surface

Following the existing `contextBridge`/`ipcMain.handle` pattern
(`client/electron/preload.ts`, `client/electron/main.ts`):
- `backup:status` (invoke) → `{ lastBackupAt: string | null, destination: string | null }`.
- `backup:run` (invoke, optional `{ chooseNewFolder: boolean }`) → runs the
  folder picker (if no remembered destination or `chooseNewFolder` is true),
  performs the copy, updates markers on success, returns the result or throws
  on failure for the renderer to toast.
- `backup:snooze` (invoke) → writes the snooze marker.

## Testing

- Unit tests for the new marker read/write helpers and the copy-to-external-
  destination + prune flow, following the existing style in
  `client/electron/backup.test.ts` (temp dirs via `fs.mkdtempSync`, no real
  filesystem outside a scratch dir).
- Unit tests for the reminder-due calculation (grace period, snooze,
  overdue thresholds) as a pure function of marker values and "now", so it
  doesn't depend on real time in tests.
- No new automated coverage for the native folder-picker dialog itself (not
  meaningfully testable outside a real OS); manual verification in a
  packaged build per `docs/release-checklist.md`.

## i18n

New strings under the `settings` namespace (Backup section) and wherever the
dashboard's existing strings live, following the current `t('...')` pattern
seen throughout `SettingsPage.tsx`.
