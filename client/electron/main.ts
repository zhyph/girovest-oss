import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import net from 'net'
import path from 'path'
import { backupDatabaseIfNeeded, writeBackupMarker } from './backup.ts'
import { resolveInstallId } from './installId.ts'
import { setupAutoUpdater } from './updater.ts'
import { ensureActivated, type ActivationState } from './activation.ts'
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
  win.webContents.on('render-process-gone', (_event, details) => {
    void logError('Renderer process gone:', details.reason)
  })
  win.webContents.on('unresponsive', () => {
    void logError('Renderer became unresponsive', undefined)
  })
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
  }

  try {
    // Backup before migrating; if the backup itself throws (e.g. disk full),
    // deliberately abort startup rather than migrate without a safety copy.
    backupDatabaseIfNeeded(
      userDataPath,
      app.getVersion(),
      new Date().toISOString().slice(0, 10),
    )
    await runMigrations(serverCwd, env, app.isPackaged)
    // Only after success: a failed upgrade must re-back-up on the next
    // launch attempt, so the marker can't move until migrations land.
    writeBackupMarker(userDataPath, app.getVersion())
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
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

  app.whenReady().then(async () => {
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
