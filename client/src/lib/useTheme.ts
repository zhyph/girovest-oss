import { useSyncExternalStore } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'

// Bridge exposed by client/electron/preload.ts (contextBridge). Absent on the
// hosted web build, so every call goes through optional chaining.
type ThemeBridge = { setTheme?: (preference: ThemePreference) => void }

function notifyElectron(preference: ThemePreference) {
  const bridge = (window as Window & { girovest?: ThemeBridge }).girovest
  bridge?.setTheme?.(preference)
}

function readStoredPreference(): ThemePreference {
  // localStorage access throws in partitioned/sandboxed storage contexts;
  // treat that the same as "no stored preference".
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

function persistPreference(preference: ThemePreference) {
  try {
    if (preference === 'system') {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, preference)
    }
  } catch {
    // Unavailable storage only loses persistence, not the in-session theme.
  }
}

function applyThemeClass(preference: ThemePreference) {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  if (preference !== 'system') {
    root.classList.add(preference)
  }
}

// Single module-level store consumed via useSyncExternalStore: every
// useTheme() consumer shares this one value, so the Settings toggle and any
// future consumer can never desync the way per-instance useState copies would.
let preference: ThemePreference = readStoredPreference()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ThemePreference {
  return preference
}

export function setThemePreference(next: ThemePreference) {
  preference = next
  applyThemeClass(next)
  persistPreference(next)
  notifyElectron(next)
  for (const listener of listeners) listener()
}

// Called once from main.tsx before the first render. The inline bootstrap
// script in index.html has already put the stored theme's class on <html>
// pre-paint (that is what prevents a wrong-theme flash); this re-applies it
// idempotently so store and DOM agree even if that script were stripped, and
// tells the Electron main process about the stored choice so native chrome
// (menus, dialogs) matches from the start. No-op difference on the web build.
export function initTheme() {
  applyThemeClass(preference)
  notifyElectron(preference)
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot)
  return { theme, setTheme: setThemePreference }
}
