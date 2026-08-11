import { contextBridge, ipcRenderer } from 'electron'

// Minimal, explicitly-enumerated bridge (contextIsolation is on by default).
// The renderer reports the user's theme choice so the main process can keep
// native chrome (menus, dialogs, window background) in step via
// nativeTheme.themeSource. Everything else still goes over plain HTTP to the
// local backend, same as the hosted web build — which has no `window.girovest`
// at all, so renderer code must always optional-chain this bridge.
contextBridge.exposeInMainWorld('girovest', {
  setTheme: (preference: 'light' | 'dark' | 'system') => {
    ipcRenderer.send('theme:set', preference)
  },
  // invoke (not send) because this one has a return value. The hosted web build
  // has no bridge at all, so the renderer treats absence as "no install id",
  // which is the correct answer there: the identifier only exists for a desktop
  // installation.
  getInstallId: (): Promise<string | null> => ipcRenderer.invoke('install:id'),
  // Only the activation screen calls this. It lives on the same bridge because
  // that screen is a data: URL loaded into the same window, and the preload
  // applies to it too.
  retryActivation: (): Promise<string> => ipcRenderer.invoke('activation:retry'),
  sendDiagnostics: (): Promise<{ ok: boolean; reason?: string }> => ipcRenderer.invoke('diagnostics:send'),
  requestPasswordReset: (
    login: string,
  ): Promise<
    | { status: 'pending'; code: string | null }
    | { status: 'approved'; token: string }
    | { status: 'denied' }
    | { status: 'unreachable' }
  > => ipcRenderer.invoke('passwordReset:request', { login }),
  getBackupStatus: (): Promise<{
    lastBackupAt: string | null
    destination: string | null
    snoozedUntil: string | null
    installDate: string
    inProgress: boolean
  }> => ipcRenderer.invoke('backup:status'),
  runBackup: (
    chooseNewFolder?: boolean,
    forceClaimDestination?: boolean,
    explicitDestination?: string,
  ): Promise<{ destination: string; archivePath: string }> =>
    ipcRenderer.invoke('backup:run', { chooseNewFolder, forceClaimDestination, explicitDestination }),
  snoozeBackupReminder: (): Promise<void> => ipcRenderer.invoke('backup:snooze'),
  pickRestoreBackup: (): Promise<{ path: string; timestamp: string | null } | null> =>
    ipcRenderer.invoke('backup:pickRestoreFile'),
  restoreBackup: (backupPath: string): Promise<void> => ipcRenderer.invoke('backup:restore', { path: backupPath }),
})
