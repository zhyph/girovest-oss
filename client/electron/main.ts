import { app, BrowserWindow, dialog } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { backupDatabaseIfNeeded, writeBackupMarker } from './backup.ts'

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

// The packaged server directory lives inside the app's read-only mounted
// resources (e.g. an AppImage's squashfs mount, or an ASAR-adjacent
// directory on Windows/NSIS installs users don't have write access to).
// That's fine for running the bundled server itself, but Prisma's
// schema-engine (used by `migrate deploy`) self-heals by copying its binary
// from its own global cache into node_modules/@prisma/engines/ whenever it
// doesn't find what it expects there — and that copy's *target* must be
// writable. Confirmed directly against a real packaged AppImage: this fails
// with EROFS against the read-only mount. Copy the whole server directory
// into a writable location under userData once per app version (re-copying
// only when the version marker doesn't match, so a normal launch doesn't
// pay for a full copy every time), and run everything from there instead.
export function ensureWritableServerRuntime(
  sourceDir: string,
  userDataPath: string,
  version: string,
): string {
  const runtimeDir = path.join(userDataPath, 'server-runtime')
  const versionMarkerPath = path.join(runtimeDir, '.version')
  const isCurrent =
    fs.existsSync(versionMarkerPath) && fs.readFileSync(versionMarkerPath, 'utf-8') === version
  if (!isCurrent) {
    fs.rmSync(runtimeDir, { recursive: true, force: true })
    fs.cpSync(sourceDir, runtimeDir, { recursive: true })
    fs.writeFileSync(versionMarkerPath, version, 'utf-8')
  }
  return runtimeDir
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

function runMigrations(serverCwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const prismaCli = path.join(serverCwd, 'node_modules', 'prisma', 'build', 'index.js')
    const migrate = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: serverCwd,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
    })
    migrate.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`prisma migrate deploy exited with code ${code}`))
    })
    migrate.on('error', reject)
  })
}

async function startServer(): Promise<boolean> {
  const userDataPath = app.getPath('userData')
  // Packaged: copy the whole resources directory (not just resources/server)
  // into the writable runtime location, preserving the server/node_modules
  // sibling relationship Node's module resolution depends on — the shared,
  // hoisted npm-workspace dependencies (effect, dotenv, zod, cors, ...) live
  // in resources/node_modules, a *sibling* of resources/server, not nested
  // under it, and resolution walks up from server/node_modules to find them.
  // Copying only resources/server (an earlier version of this fix) broke
  // that walk-up entirely — confirmed directly by reproducing the resulting
  // "Cannot find module 'effect'" error before catching and fixing it here.
  const serverCwd = app.isPackaged
    ? path.join(
        ensureWritableServerRuntime(process.resourcesPath, userDataPath, app.getVersion()),
        'server',
      )
    : resolveServerRuntimeCwd(app.isPackaged, app.getAppPath(), process.resourcesPath)

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DB_PROVIDER: 'sqlite',
    DATABASE_URL: resolveDatabaseUrl(userDataPath),
    JWT_SECRET: resolveJwtSecret(userDataPath),
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
    await runMigrations(serverCwd, env)
    // Only after success: a failed upgrade must re-back-up on the next
    // launch attempt, so the marker can't move until migrations land.
    writeBackupMarker(userDataPath, app.getVersion())
  } catch (error) {
    console.error('Database preparation failed:', error)
    return false
  }

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
    console.error('Backend process failed to start:', error)
  })
  serverProcess.on('exit', (code) => {
    if (isShuttingDown) return
    isShuttingDown = true
    console.error(`Backend process exited unexpectedly with code ${code}\n${recentOutput}`)
    dialog.showErrorBox(
      'Server Stopped Unexpectedly',
      `The application server stopped unexpectedly (exit code ${code}). The app will now close.\n\n${recentOutput.trim()}`,
    )
    app.quit()
  })

  return true
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
    },
  })

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
  // Must run before app.whenReady() resolves: Electron resolves the default
  // userData path from package.json's name as soon as it's ready, so setting
  // the name any later (e.g. inside startServer(), which used to run this
  // after whenReady()) is a no-op and userData silently lands in the wrong
  // directory (girovest-client instead of girovest).
  app.setName('girovest')

  app.whenReady().then(async () => {
    const started = await startServer()
    if (!started) {
      dialog.showErrorBox(
        'Startup Failed',
        'The application database could not be prepared (migration failed). The app will now close. Check the logs for details.',
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

    createWindow()
  })

  app.on('window-all-closed', () => {
    isShuttingDown = true
    serverProcess?.kill()
    app.quit()
  })
}
