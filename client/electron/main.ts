import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import net from 'net'
import path from 'path'
import { backupDatabaseIfNeeded, writeBackupMarker } from './backup.ts'
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
import { resolveInstallId } from './installId.ts'
import { setupAutoUpdater } from './updater.ts'
import { ensureActivated, resolveHostname, type ActivationState } from './activation.ts'
import { resolveMachineHash } from './machineId.ts'
import { activationScreenHtml } from './activationScreen.ts'

export function resolveServerCwd(appRoot: string): string {
  return path.resolve(appRoot, '..', 'server')
}

export function resolveServerRuntimeCwd(
  isPackaged: boolean,
  appRoot: string,
  resourcesPath: string,
): string {
  return isPackaged ? path.join(resourcesPath, 'server') : resolveServerCwd(appRoot)
}

// Packaged builds get icon.png copied to the resources root by the
// extraResources entry in electron-builder.yml. Dev mode reads the same
// source PNG straight from build/ (app.getAppPath() is the client/ project
// root in dev), since that directory is never packaged.
export function resolveIconPath(
  isPackaged: boolean,
  appRoot: string,
  resourcesPath: string,
): string {
  return isPackaged ? path.join(resourcesPath, 'icon.png') : path.join(appRoot, 'build', 'icon.png')
}

// Packaged builds ship a single esbuild-bundled file (server-bundle.mjs) that
// inlines everything except the two native modules (bcrypt, better-sqlite3),
// so the app isn't exposed to npm workspace hoisting silently dropping a
// transitive dependency. Dev mode keeps running the plain tsc output
// (dist/server.js) directly — no bundling step needed for fast iteration.
export function resolveServerEntry(isPackaged: boolean): string {
  return isPackaged ? 'server-bundle.mjs' : 'dist/server.js'
}

export function resolveJwtSecret(userDataPath: string): string {
  const secretPath = path.join(userDataPath, 'jwt-secret')
  if (fs.existsSync(secretPath)) {
    return fs.readFileSync(secretPath, 'utf-8')
  }
  const secret = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(secretPath, secret, 'utf-8')
  return secret
}

export function resolveDatabaseUrl(userDataPath: string): string {
  return `file:${path.join(userDataPath, 'dev.db')}`
}

export function resolveProductPhotosDir(userDataPath: string): string {
  return path.join(userDataPath, 'product-photos')
}

// Presence-only marker: written once a machine has actually crash-looped
// (see recordCrashAndCheckLoop), read at next launch to decide whether to
// call app.disableHardwareAcceleration(). Deliberately per-machine and
// evidence-based rather than a blanket default off for every install.
export function resolveGpuDisableFlagPath(userDataPath: string): string {
  return path.join(userDataPath, 'gpu-disabled')
}

// Same split as resolveServerEntry, for the migration step: dev runs the tsc
// output, packaged builds run the esbuild bundle sitting next to
// server-bundle.mjs. Replaces the Prisma CLI (`prisma migrate deploy`) — see
// server/src/db/migrationRunner.ts for why and for the compatibility
// guarantees. This is also what lets the app run straight out of the
// read-only resources directory: the old CLI's schema-engine self-healed by
// copying a binary into node_modules (EROFS on an AppImage mount), which
// forced a full writable copy of resources into userData. The runner writes
// only to the database file, which already lives in userData.
export function resolveMigrateEntry(isPackaged: boolean): string {
  return isPackaged ? 'migrate.mjs' : 'dist/migrate-cli.js'
}

// Versions up to 0.5.0 copied all of resources (server bundle plus ~450MB of
// node_modules) into userData/server-runtime at first launch to work around
// the EROFS problem above. That copy is dead weight now that nothing needs a
// writable server directory — reclaim the disk on installs upgrading from
// those versions.
export function cleanupLegacyServerRuntime(userDataPath: string): void {
  fs.rmSync(path.join(userDataPath, 'server-runtime'), { recursive: true, force: true })
}

// electron-updater's quitAndInstall spawns the NEW app instance before the
// old one finishes quitting, so the new instance can reach startServer while
// the old server still holds the port. Probe by actually binding (the only
// reliable "is it free" test) until the old process releases it.
export async function waitForPortFree(
  port: number,
  host: string,
  timeoutMs = 5_000,
  intervalMs = 150,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = net.createServer()
      probe.once('error', () => resolve(false))
      probe.once('listening', () => probe.close(() => resolve(true)))
      probe.listen(port, host)
    })
    if (free) return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

// On an electron-updater restart, the new instance has no ChildProcess
// handle to the OLD instance (unlike the restore flow's waitForProcessExit,
// which waits on a process THIS instance spawned) — so the only reliable
// check is to try a file operation that will fail if another process holds it
// open, and retry on failure, mirroring waitForPortFree's probe-until-free loop.
// We use renameSync(filePath, filePath) rather than openSync for writability because
// on POSIX, open() with 'r+' succeeds even if another process has the file open
// (POSIX open() has no default exclusivity). On Windows, SQLite's default VFS
// also opens db files with FILE_SHARE_READ | FILE_SHARE_WRITE, so a second open
// is also likely to succeed rather than throw. Renaming or deleting a file,
// however, throws EBUSY/EPERM on Windows when another process holds it open
// without FILE_SHARE_DELETE — this app's own restore flow (see waitForProcessExit)
// relies on precisely this mechanism to wait for a killed server process to
// actually release its handles before touching the database. A self-rename
// exercises that same check without actually moving anything, and it's a real
// detector on the platform this app actually ships on (Windows via NSIS).
// This is still a best-effort heuristic: no real detection exists on POSIX dev
// machines/CI, but that's an accepted, pre-existing gap (this app doesn't ship for POSIX).
export async function waitForFileWritable(
  filePath: string,
  timeoutMs = 5_000,
  intervalMs = 150,
): Promise<boolean> {
  if (!fs.existsSync(filePath)) return true
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      fs.renameSync(filePath, filePath)
      return true
    } catch {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  return false
}

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

export async function waitForServerReady(
  url: string,
  timeoutMs = 10_000,
  intervalMs = 150,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      // Server isn't accepting connections yet; keep polling until the timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

let serverProcess: ChildProcess | null = null
// Tracks whether the server process is being torn down intentionally (normal
// app shutdown, or a startup failure we're already reporting) so the 'exit'
// handler below doesn't show a duplicate/incorrect crash dialog in those cases.
let isShuttingDown = false

function runMigrations(
  serverCwd: string,
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const migrate = spawn(process.execPath, [resolveMigrateEntry(isPackaged)], {
      cwd: serverCwd,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'pipe',
    })
    // stdio: 'pipe', not 'inherit': a packaged Windows build runs under the
    // GUI subsystem with no parent console for 'inherit' to attach to, so
    // Prisma's actual error text was being silently discarded and only the
    // bare exit code survived. Capture the tail so the real reason reaches
    // both the log file and the failure dialog.
    let output = ''
    const capture = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4000)
    }
    migrate.stdout?.on('data', capture)
    migrate.stderr?.on('data', capture)
    migrate.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`database migration exited with code ${code}\n${output.trim()}`))
    })
    migrate.on('error', reject)
  })
}

// electron-log's transports (file + console) are configured as a side effect
// of importing it, and that import touches Electron internals `app` doesn't
// expose under Vitest (see the dynamic-import comment on resolveActivation
// below) -- so every call site imports it lazily like this rather than once
// at module scope.
async function logError(message: string, error: unknown): Promise<void> {
  const log = (await import('electron-log')).default
  log.error(message, error)
}

async function logInfo(message: string): Promise<void> {
  const log = (await import('electron-log')).default
  log.info(message)
}

// Sliding-window crash-loop detector: mutates `timestamps` in place (drops
// entries older than the window) and returns whether the threshold has been
// reached within it. Pure aside from that mutation, so it's testable without
// any Electron dependency -- same style as waitForPortFree above.
export function recordCrashAndCheckLoop(
  timestamps: number[],
  now: number,
  windowMs = 30_000,
  threshold = 3,
): boolean {
  timestamps.push(now)
  while (timestamps.length > 0 && now - timestamps[0]! > windowMs) {
    timestamps.shift()
  }
  return timestamps.length >= threshold
}

// Mirrors the renderer's DevTools console into main.log. Without this, a
// renderer-side error (e.g. a page component throwing during render) is only
// ever visible in DevTools -- invisible on a packaged Windows build where a
// shop can't reach DevTools, and invisible in main.log, since electron-log is
// otherwise only ever called from this file's own main-process code.
function attachConsoleLogging(win: BrowserWindow): void {
  win.webContents.on('console-message', (details) => {
    void (async () => {
      const log = (await import('electron-log')).default
      const line = `[renderer] ${details.message} (${details.sourceId}:${details.lineNumber})`
      if (details.level === 'error') log.error(line)
      else if (details.level === 'warning') log.warn(line)
      else log.info(line)
    })()
  })
  // A crashed renderer takes React (and ChunkErrorBoundary with it) down
  // along with the process -- there is no JS left running to catch anything
  // or show a fallback, which is exactly the "solid screen" symptom that
  // adding the boundary at the app root did not fix. Recover by reloading
  // webContents instead of leaving a dead window. 'clean-exit' is excluded:
  // that's an intentional close (e.g. during app shutdown), not a crash, and
  // reloading a webContents whose window is going away would just interfere
  // with normal quit. If reloading keeps failing (a crash loop -- e.g. a bad
  // GPU driver crashing the renderer immediately on every launch), stop
  // reloading and quit with an explanation instead of silently hammering the
  // user with an invisible crash/reload cycle forever.
  const crashTimestamps: number[] = []
  win.webContents.on('render-process-gone', (_event, details) => {
    void logError('Renderer process gone:', details.reason)
    if (details.reason === 'clean-exit') return

    if (recordCrashAndCheckLoop(crashTimestamps, Date.now())) {
      // Best-effort: if this can't be written, the relaunch just retries
      // with GPU acceleration still on and may crash-loop again -- no worse
      // than today's behavior, just not self-healing this time.
      try {
        fs.writeFileSync(resolveGpuDisableFlagPath(app.getPath('userData')), '')
      } catch (error) {
        void logError('Failed to write GPU-disable flag:', error)
      }
      dialog.showErrorBox(
        'Girovest Crashed Repeatedly',
        'The application kept crashing and will now restart in a compatibility mode.\n\nContact support if this keeps happening.',
      )
      isShuttingDown = true
      serverProcess?.kill()
      app.relaunch()
      app.exit(0)
      return
    }

    // Used to reload straight away with nothing said: whoever was mid-task
    // (mid-login, most importantly -- see the login-lockout investigation
    // this was changed for) saw the page flash and empty itself with zero
    // explanation, indistinguishable from the app just doing nothing. A
    // blocking dialog first means the reload is never silent, at the cost of
    // one click; showErrorBox blocks this handler until dismissed, which is
    // fine here -- there is nothing else for the main process to do until
    // the shop has read it.
    dialog.showErrorBox(
      'Girovest Restarting',
      'The application ran into a problem and this screen needs to restart. Anything you were entering (like a login attempt) was not saved -- please try again after it reloads.',
    )
    win.webContents.reload()
  })
  win.webContents.on('unresponsive', () => {
    void logError('Renderer became unresponsive', undefined)
  })
}

// Matches the Worker's own cap (infra/update-proxy/src/worker.ts,
// DIAGNOSTIC_LOG_MAX_CHARS) -- sending more than it will keep would just
// waste the upload.
const DIAGNOSTIC_LOG_MAX_CHARS = 100_000

/**
 * The tail of this run's own main.log, for the "Enviar diagnóstico" button
 * (client/src/components/DiagnosticsButton.tsx). electron-log's own
 * `getFile().path` is used rather than guessing the platform path, since that
 * guess would silently drift from wherever electron-log is actually
 * configured to write.
 */
async function readRecentLogTail(maxChars: number): Promise<string> {
  try {
    const log = (await import('electron-log')).default
    const content = fs.readFileSync(log.transports.file.getFile().path, 'utf-8')
    return content.slice(-maxChars)
  } catch (error) {
    void logError('Failed to read log tail for diagnostics:', error)
    return ''
  }
}

// Patterns matched against the diagnostic log tail right before it leaves
// this computer (the 'diagnostics:send' handler below), never against the
// log FILE on disk -- main.log stays full-fidelity locally, since 6.2's "no
// client data leaves this computer" promise is about the network egress,
// not what a shop's own support tech can read from their own machine.
//
// Defense in depth, not a data source: nothing in this app deliberately logs
// client names, phones, CPFs, or addresses (validation failures throw a
// generic AppError, e.g. server/src/routes/clients.ts, never an echo of the
// bad payload). The real risk this guards is indirect -- e.g. a backend
// crash forwarding raw stdout/stderr into main.log (see `recentOutput`
// below), where an unexpected driver/library error could in principle
// stringify something it shouldn't. Best-effort pattern matching over free
// text, not a guarantee: see docs/comercial/minuta-licenca-uso.md clause
// 6.2.1(iv), which is careful to say so rather than promise more than this
// can actually deliver.
const CPF_PATTERN = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g
const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g
// Requires an area-code-shaped prefix (parens, or a bare-digit pair followed
// by a dash) so this doesn't also eat UUIDs, timestamps, or port numbers,
// which are all over a technical log and share the same run of bare digits
// otherwise. \b only goes in front of the \d{2}- alternative -- a `(` is
// its own unambiguous delimiter and \b does not match the boundary between
// a space and `(` (neither side is a word character), so requiring it there
// would silently make that whole alternative never match.
const PHONE_PATTERN = /(?:\(\d{2}\)\s?|\b\d{2}-)9?\d{4}-?\d{4}\b/g

export function redactPersonalDataForUpload(text: string): string {
  return text
    .replace(CPF_PATTERN, '[CPF removido]')
    .replace(EMAIL_PATTERN, '[email removido]')
    .replace(PHONE_PATTERN, '[telefone removido]')
}

// This app ships no old build to roll back to (NSIS installs in place, no
// downgrade path), and the packaged app never carries the Prisma CLI (see
// migrationRunner.ts) -- so "run prisma migrate resolve" is a dead end for
// whoever reads this dialog. Lead with support, and point at the real backup
// this launch just made (or explain why there isn't one) instead.
//
// The copy-back list must name every sidecar backupDatabaseIfNeeded() can have
// captured -- it copies dev.db plus ALL "dev.db-*" files verbatim (see
// backup.ts), so a backed-up WAL/journal belongs to, and must be restored
// alongside, the dev.db copied with it. Restoring dev.db while leaving one of
// its sidecars behind (or dropping one from this list) can leave a
// partially-applied transaction in place.
export function buildStartupFailureDetail(
  errorMessage: string,
  backupPath: string | null,
): string {
  const backupInstruction = backupPath
    ? `Your data was backed up before this update ran, at:\n${backupPath}\n\n` +
      `To recover: quit the app, delete "dev.db-wal", "dev.db-journal", and "dev.db-shm" ` +
      `from the app's data folder if present, then copy "dev.db" (and any "dev.db-wal"/` +
      `"dev.db-journal"/"dev.db-shm" files) from the backup folder above back into the ` +
      `data folder. ` +
      `Restoring this backup will not by itself fix the update failure -- contact support ` +
      `with this message before retrying.`
    : `No backup was needed (this looks like a fresh install). Contact support with this message.`

  return `${errorMessage}\n\n${backupInstruction}`
}

// Returns null on success, or the failure detail to show/log otherwise.
async function startServer(): Promise<string | null> {
  const userDataPath = app.getPath('userData')
  const serverCwd = resolveServerRuntimeCwd(app.isPackaged, app.getAppPath(), process.resourcesPath)
  // Best-effort: a locked file (e.g. Windows AV holding a handle) must not
  // block startup — the stale copy is only wasted disk, and the next launch
  // retries.
  try {
    cleanupLegacyServerRuntime(userDataPath)
  } catch (error) {
    await logError('Failed to remove legacy server-runtime copy:', error)
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DB_PROVIDER: 'sqlite',
    DATABASE_URL: resolveDatabaseUrl(userDataPath),
    JWT_SECRET: resolveJwtSecret(userDataPath),
    PRODUCT_PHOTOS_DIR: resolveProductPhotosDir(userDataPath),
    HOST: '127.0.0.1',
    PORT: '3000',
    GIROVEST_UPDATE_URL: GIROVEST_UPDATE_URL || '',
    GIROVEST_UPDATE_KEY: GIROVEST_UPDATE_KEY || '',
    GIROVEST_INSTALL_ID: resolveInstallId(userDataPath),
    // Same public key the activation lock already verifies Ed25519 tokens
    // with (see activation.ts) -- reused, not duplicated, so a support-issued
    // password-reset ticket (server/src/auth/passwordResetTickets.ts) needs
    // no secret of its own to check.
    GIROVEST_ACTIVATION_PUBKEY: GIROVEST_ACTIVATION_PUBKEY || '',
  }

  // Captured here (rather than left as backupDatabaseIfNeeded's discarded
  // return value) so a subsequent migration failure can tell the operator
  // exactly where their pre-update backup landed instead of leaving them to
  // guess a path -- see buildStartupFailureDetail.
  let backupPath: string | null = null
  try {
    // Must happen before the backup, not just before migrations: the backup
    // itself does three non-atomic copyFileSync calls, and a still-writing
    // previous process could make each one individually succeed while the
    // result is internally torn. Best-effort: proceeding after a timeout
    // (rather than aborting) matches this app's existing "a locked file must
    // not block startup forever" posture elsewhere in this function.
    await waitForFileWritable(resolveDatabaseUrl(userDataPath).replace(/^file:/, ''))
    // Backup before migrating; if the backup itself throws (e.g. disk full),
    // deliberately abort startup rather than migrate without a safety copy.
    backupPath = backupDatabaseIfNeeded(
      userDataPath,
      app.getVersion(),
      new Date().toISOString().slice(0, 10),
    )
    await runMigrations(serverCwd, env, app.isPackaged)
    // Only after success: a failed upgrade must re-back-up on the next
    // launch attempt, so the marker can't move until migrations land.
    writeBackupMarker(userDataPath, app.getVersion())
  } catch (error) {
    const detail = buildStartupFailureDetail(
      error instanceof Error ? error.message : String(error),
      backupPath,
    )
    await logError('Database preparation failed:', error)
    return detail
  }

  // During an update restart the previous instance's server may not have
  // released the port yet (see waitForPortFree). Not-free after the timeout
  // isn't fatal by itself — fall through and let the server's own EADDRINUSE
  // produce the existing crash dialog rather than duplicating it here.
  await waitForPortFree(Number(env.PORT), env.HOST as string)

  serverProcess = spawn(process.execPath, [resolveServerEntry(app.isPackaged)], {
    cwd: serverCwd,
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'pipe',
  })

  // stdio: 'pipe' means the server's own console output goes nowhere unless
  // something reads it — capture the tail of it so a crash dialog can show
  // *why* it failed (e.g. "port already in use") instead of a bare exit code.
  let recentOutput = ''
  const captureOutput = (chunk: Buffer) => {
    recentOutput = (recentOutput + chunk.toString()).slice(-2000)
  }
  serverProcess.stdout?.on('data', captureOutput)
  serverProcess.stderr?.on('data', captureOutput)

  serverProcess.on('error', (error) => {
    void logError('Backend process failed to start:', error)
  })
  serverProcess.on('exit', (code) => {
    if (isShuttingDown) return
    isShuttingDown = true
    void logError(`Backend process exited unexpectedly with code ${code}`, recentOutput.trim())
    dialog.showErrorBox(
      'Server Stopped Unexpectedly',
      `The application server stopped unexpectedly (exit code ${code}). The app will now close.\n\n${recentOutput.trim()}`,
    )
    app.quit()
  })

  return null
}

// Injected at build time by electron.vite.config.ts, alongside the updater's
// constants. Empty when the build did not set them, which disables the lock:
// see the `unverifiable` branch in ensureActivated.
declare const GIROVEST_UPDATE_URL: string
declare const GIROVEST_UPDATE_KEY: string
declare const GIROVEST_ACTIVATION_PUBKEY: string
declare const GIROVEST_SUPPORT_CONTACT: string

/**
 * Loads the "not released yet" screen into an existing window.
 *
 * A data: URL rather than a file so the screen has no filesystem or network
 * dependency of its own -- it is precisely the thing that must still render
 * when everything else failed.
 */
function loadActivationScreen(win: BrowserWindow, state: ActivationState): void {
  const html = activationScreenHtml(state, GIROVEST_SUPPORT_CONTACT || 'suporte')
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

/**
 * Runs the activation check and records the outcome in the log.
 *
 * The log line matters for support: `unverifiable` and `activated` look
 * identical to the shop (the app just opens), so without it there is no way to
 * tell a released installation from one that skipped the check.
 */
async function resolveActivation(installId: string, userDataPath: string): Promise<ActivationState> {
  const state = await ensureActivated({
    userDataPath,
    installId,
    machineHash: resolveMachineHash(),
    publicKey: GIROVEST_ACTIVATION_PUBKEY,
    endpoint:
      GIROVEST_UPDATE_URL && GIROVEST_UPDATE_KEY
        ? { url: GIROVEST_UPDATE_URL, productKey: GIROVEST_UPDATE_KEY }
        : null,
  })
  // electron-log, not console.log: `console` in the main process is not routed
  // to the log file, so a console.log here would go to stdout and vanish for a
  // packaged app. This line is the only way support can tell an `activated`
  // install from an `unverifiable` one, since both simply open the app.
  const log = (await import('electron-log')).default
  log.info(`[activation] ${state.state}`)
  return state
}

function createWindow(state: ActivationState): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    // Match the renderer theme's --background (src/index.css) so opening or
    // resizing the window doesn't flash white before the first paint when
    // the app renders dark.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#241c1b' : '#faf6f0',
    icon: resolveIconPath(app.isPackaged, app.getAppPath(), process.resourcesPath),
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
    },
  })

  attachConsoleLogging(win)
  loadAppOrActivation(win, state)
  return win
}

/** Loads the real app when released, the activation screen otherwise. */
function loadAppOrActivation(win: BrowserWindow, state: ActivationState): void {
  // `unverifiable` deliberately loads the app: it means no machine fingerprint
  // was readable, or this build carries no activation config. Both are our
  // problem, not the shop's, and neither justifies locking anyone out.
  if (state.state !== 'activated' && state.state !== 'unverifiable') {
    loadActivationScreen(win, state)
    return
  }
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
  }
}

// `electron` resolves to a plain string (the path to the Electron binary)
// when this module is loaded outside the real Electron runtime — e.g. by
// Vitest, which imports this file directly to unit-test the pure helpers
// above. Guard the app bootstrap so importing this module for tests doesn't
// try to call methods on that string. Under a real Electron process `app`
// is always a populated object, so production behavior is unaffected.
if (app) {
  // Without these, an error thrown outside the explicit try/catches above
  // (e.g. inside an IPC handler, or a rejected promise nobody awaited) would
  // crash the main process with nothing recorded anywhere in a packaged
  // build — the same silent-failure gap `logError` closes for startup.
  process.on('uncaughtException', (error) => {
    void logError('Uncaught exception in main process:', error).then(() => {
      dialog.showErrorBox(
        'Unexpected Error',
        `Girovest hit an unexpected error and will close.\n\n${error.message}`,
      )
      app.quit()
    })
  })
  process.on('unhandledRejection', (reason) => {
    void logError('Unhandled promise rejection in main process:', reason)
  })

  // Must run before app.whenReady() resolves: Electron resolves the default
  // userData path from package.json's name as soon as it's ready, so setting
  // the name any later (e.g. inside startServer(), which used to run this
  // after whenReady()) is a no-op and userData silently lands in the wrong
  // directory (girovest-client instead of girovest).
  app.setName('girovest')

  // Left on by default: most machines render fine with GPU acceleration, and
  // disabling it for everyone costs smoothness for a problem most installs
  // never have. Only a machine that has actually crash-looped (see
  // recordCrashAndCheckLoop below) gets this -- that run persists the flag
  // file and relaunches, and disableHardwareAcceleration only takes effect
  // for a NEW process, so this check has to run this early, before
  // whenReady(), to catch that relaunch.
  const gpuDisabled = fs.existsSync(resolveGpuDisableFlagPath(app.getPath('userData')))
  if (gpuDisabled) {
    app.disableHardwareAcceleration()
  }
  // Diagnostic only, not a behavior change: confirms in main.log whether this
  // launch actually disabled hardware acceleration and what Chromium's GPU
  // feature status is, so a repeat crash after the flag is set answers
  // whether GPU/driver was ever the cause instead of leaving it a guess.
  void logInfo(`GPU acceleration disabled by flag: ${gpuDisabled}`)

  // Keep native chrome (menus, dialogs, and the window backgroundColor
  // above for windows created later) in step with the in-app theme choice.
  // The renderer sends this on boot and on every change via the preload
  // bridge; 'system' resets Electron to following the OS preference.
  ipcMain.on('theme:set', (_event, preference: unknown) => {
    if (preference === 'light' || preference === 'dark' || preference === 'system') {
      nativeTheme.themeSource = preference
    }
  })

  // Exposed so the shop can read its own install id off the Settings screen and
  // relay it over the phone: it is the handle used to revoke that one
  // installation's updates (see docs/update-proxy-runbook.md), and without a
  // screen the only ways to obtain it are walking to the machine or grepping
  // the proxy logs.
  //
  // Resolved lazily and memoized rather than at module load: app.getPath
  // ('userData') is only correct after app.setName above, and this handler is
  // registered next to the other one for symmetry, before whenReady resolves.
  // First invocation always arrives long after the window exists.
  let cachedInstallId: string | null = null
  ipcMain.handle('install:id', () => {
    cachedInstallId ??= resolveInstallId(app.getPath('userData'))
    return cachedInstallId
  })

  // Correlates a renderer crash with a same-time crash of another Chromium
  // process (most importantly 'GPU'): render-process-gone alone can't tell us
  // whether the GPU process died first and took the renderer down with it,
  // or the renderer died on its own for an unrelated reason (e.g. a
  // third-party DLL injected into it by security/overlay software).
  app.on('child-process-gone', (_event, details) => {
    void logError('Child process gone:', details)
  })

  app.whenReady().then(async () => {
    void logInfo(`GPU feature status: ${JSON.stringify(app.getGPUFeatureStatus())}`)

    const startupError = await startServer()
    if (startupError !== null) {
      dialog.showErrorBox(
        'Startup Failed',
        `The application database could not be prepared (migration failed). The app will now close.\n\n${startupError}`,
      )
      app.quit()
      return
    }

    const ready = await waitForServerReady('http://127.0.0.1:3000/health')
    if (!ready) {
      isShuttingDown = true
      serverProcess?.kill()
      dialog.showErrorBox(
        'Startup Failed',
        'The application server did not become ready in time. The app will now close.',
      )
      app.quit()
      return
    }

    const userDataPath = app.getPath('userData')
    // Resolved here rather than inside setupAutoUpdater so the file lives
    // next to the other userData-backed values and stays independent of
    // whether the updater is enabled in this build.
    const installId = resolveInstallId(userDataPath)

    // Awaited before the window exists on purpose. With a valid stored token
    // this touches no network at all and returns in microseconds; only a first
    // run (or a machine change) pays for a round trip, and paying it here beats
    // flashing the real app for a second before replacing it with a lock screen.
    const activation = await resolveActivation(installId, userDataPath)
    const win = createWindow(activation)

    // Retry from the lock screen. Re-runs the whole check rather than trusting
    // the previous outcome: between the two attempts the owner has typically
    // just approved the installation in the admin panel.
    ipcMain.handle('activation:retry', async () => {
      const next = await resolveActivation(installId, userDataPath)
      loadAppOrActivation(win, next)
      return next.state
    })

    // Reachable from the login screen, not just Settings: the incident this
    // was built for was a login that failed silently, and Settings sits
    // behind the very login that can be broken (see DiagnosticsButton.tsx,
    // mounted at the app root). Same product key and Worker as
    // activation/updates -- no new config needed.
    ipcMain.handle('diagnostics:send', async () => {
      if (!GIROVEST_UPDATE_URL || !GIROVEST_UPDATE_KEY) {
        return { ok: false, reason: 'not_configured' }
      }
      const log = await readRecentLogTail(DIAGNOSTIC_LOG_MAX_CHARS)
      if (log === '') {
        return { ok: false, reason: 'no_log' }
      }
      try {
        const response = await fetch(`${GIROVEST_UPDATE_URL.replace(/\/+$/, '')}/diagnostics`, {
          method: 'POST',
          headers: { authorization: `Bearer ${GIROVEST_UPDATE_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ installId, hostname: resolveHostname(), log: redactPersonalDataForUpload(log) }),
        })
        return { ok: response.ok }
      } catch (error) {
        void logError('Failed to send diagnostics:', error)
        return { ok: false, reason: 'network' }
      }
    })

    // Layer 2 of password recovery, for when the self-service recovery code
    // (see recoveryCodes.ts server-side) is itself lost: same pending/poll
    // shape as activation, minus the machine binding, plus a human on the
    // other end -- see infra/update-proxy/src/lib/passwordReset.ts's header
    // for the full design. Called repeatedly by SupportResetPage.tsx
    // (a "tentar novamente" button, not a background timer): each call is
    // both "please create/refresh my pending request" and "check whether it
    // was approved yet" in one round trip.
    ipcMain.handle('passwordReset:request', async (_event, args: { login: string }) => {
      if (!GIROVEST_UPDATE_URL || !GIROVEST_UPDATE_KEY) {
        return { status: 'unreachable' as const }
      }
      try {
        const response = await fetch(`${GIROVEST_UPDATE_URL.replace(/\/+$/, '')}/password-reset`, {
          method: 'POST',
          headers: { authorization: `Bearer ${GIROVEST_UPDATE_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ installId, login: args.login, hostname: resolveHostname() }),
        })
        const body = (await response.json().catch(() => ({}))) as { status?: unknown; token?: unknown; code?: unknown }
        if (response.status === 200 && body.status === 'approved' && typeof body.token === 'string') {
          return { status: 'approved' as const, token: body.token }
        }
        if (response.status === 202 && body.status === 'pending') {
          return { status: 'pending' as const, code: typeof body.code === 'string' ? body.code : null }
        }
        if (response.status === 403 && body.status === 'denied') {
          return { status: 'denied' as const }
        }
        return { status: 'unreachable' as const }
      } catch (error) {
        void logError('Failed to request password reset:', error)
        return { status: 'unreachable' as const }
      }
    })

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

    ipcMain.handle('backup:run', async (_event, args: { chooseNewFolder?: boolean; forceClaimDestination?: boolean; explicitDestination?: string } = {}) => {
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
        args.forceClaimDestination ?? false,
        args.explicitDestination,
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
        const restoreResult = await runManualRestore({
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
        // The database has already committed at this point even when
        // photosRestored is false (see runManualRestore's own comment) —
        // this is the one place that fact can be surfaced anywhere, since
        // nothing in that case throws.
        if (!restoreResult.photosRestored) {
          await logError(
            'Restore: database restored, but the product-photos swap did not complete. ' +
              'Recoverable from product-photos.old or restore-staging/product-photos in userData.',
            undefined,
          )
        }
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

    void setupAutoUpdater(installId)
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  // The server kill MUST live on will-quit, not window-all-closed: Electron
  // does not emit window-all-closed when app.quit() is called by code — only
  // when the user closes the windows themselves. electron-updater's
  // quitAndInstall quits exactly that way, and with the kill on
  // window-all-closed the server survived as an orphan holding port 3000,
  // so the freshly installed version crash-looped on EADDRINUSE (observed
  // directly on a real 0.2.1 -> 0.2.2 AppImage update). will-quit fires on
  // every quit path, user-initiated or programmatic.
  app.on('will-quit', () => {
    isShuttingDown = true
    serverProcess?.kill()
  })
}
