import { app, BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import path from 'path'

export function resolveServerCwd(appRoot: string): string {
  return path.resolve(appRoot, '..', 'server')
}

let serverProcess: ChildProcess | null = null

function startServer() {
  const serverCwd = resolveServerCwd(app.getAppPath())
  serverProcess = spawn('node', ['dist/server.js'], {
    cwd: serverCwd,
    env: { ...process.env, DB_PROVIDER: 'sqlite', PORT: '3000' },
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
// Vitest, which imports this file directly to unit-test resolveServerCwd().
// Guard the app bootstrap so importing this module for tests doesn't try to
// call methods on that string. Under a real Electron process `app` is
// always a populated object, so production behavior is unaffected.
if (app) {
  app.whenReady().then(() => {
    startServer()
    createWindow()
  })

  app.on('window-all-closed', () => {
    serverProcess?.kill()
    app.quit()
  })
}
