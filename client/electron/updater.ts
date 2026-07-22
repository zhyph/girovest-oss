import { app, dialog } from 'electron'

// Shop machines stay open all day; launch-only checks would miss updates.
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

// In-memory on purpose: the downloaded update persists across restarts via
// electron-updater's own cache, so re-prompting once after a restart is
// correct. What this guards against is the 4h interval re-emitting
// update-downloaded for the same cached download all day. It stores the
// version (not a boolean) so a superseding release published mid-day still
// prompts — which is also why the interval keeps running after a download.
let promptedVersion: string | null = null

export async function setupAutoUpdater(): Promise<void> {
  // Optional chaining matters: under Vitest `app` is undefined (see the
  // `if (app)` guard comment in main.ts), and a bare `app.isPackaged` here
  // would TypeError if a future test ever calls this. In dev (real Electron,
  // not packaged) isPackaged is false. Either way: return, no updater.
  if (!app?.isPackaged) return

  // Dynamic imports, deliberately after the isPackaged guard: this module is
  // (transitively) imported by main.test.ts under Vitest, where 'electron'
  // is a plain string. electron-updater's `autoUpdater` export is a lazy
  // getter that instantiates a platform updater touching electron.app the
  // moment it's destructured — top-level access would crash the test suite.
  // electron-updater is also CJS: default-import + destructure, not a named
  // ESM import (electron-builder issue #7976).
  const log = (await import('electron-log')).default
  const { autoUpdater } = (await import('electron-updater')).default

  log.transports.file.level = 'info'
  autoUpdater.logger = log

  // Mandatory: autoUpdater is an EventEmitter, and an 'error' emission with
  // no listener is an uncaught exception — a crash dialog for an offline
  // shop. Log and wait for the next interval instead.
  autoUpdater.on('error', (error) => {
    log.warn('Auto-update error (will retry on next interval):', error)
  })

  autoUpdater.on('update-downloaded', async (info) => {
    if (promptedVersion === info.version) return
    promptedVersion = info.version
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Atualização pronta',
      message: `A versão ${info.version} foi baixada.`,
      detail:
        'Reinicie agora para aplicar a atualização, ou continue trabalhando — ela será instalada quando você fechar o aplicativo.',
      buttons: ['Reiniciar agora', 'Mais tarde'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })

  // checkForUpdates() both emits 'error' AND rejects its promise on failure;
  // the event handler above already logs, so swallow the rejection.
  const check = () => void autoUpdater.checkForUpdates().catch(() => {})
  check()
  setInterval(check, CHECK_INTERVAL_MS)
}
