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
})
