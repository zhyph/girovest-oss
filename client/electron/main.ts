import { app, BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

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

let serverProcess: ChildProcess | null = null

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

async function startServer() {
  app.setName('dress-store-app')
  const userDataPath = app.getPath('userData')
  const serverCwd = resolveServerRuntimeCwd(
    app.isPackaged,
    app.getAppPath(),
    process.resourcesPath,
  )

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DB_PROVIDER: 'sqlite',
    DATABASE_URL: resolveDatabaseUrl(userDataPath),
    JWT_SECRET: resolveJwtSecret(userDataPath),
    HOST: '127.0.0.1',
    PORT: '3000',
  }

  try {
    await runMigrations(serverCwd, env)
  } catch (error) {
    console.error('Database migration failed:', error)
    return
  }

  serverProcess = spawn(process.execPath, ['dist/server.js'], {
    cwd: serverCwd,
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'pipe',
  })
  serverProcess.on('error', (error) => {
    console.error('Backend process failed to start:', error)
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.js'),
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
  app.whenReady().then(async () => {
    await startServer()
    createWindow()
  })

  app.on('window-all-closed', () => {
    serverProcess?.kill()
    app.quit()
  })
}
