import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, HashRouter } from 'react-router'
import { AppRouter } from './app/router.tsx'
import { useAuth } from './lib/useAuth.ts'
import { ToastProvider } from './components/ui/toast.tsx'
import i18n from './i18n.ts'

const queryClient = new QueryClient()

// The packaged Electron app loads index.html via file://, where
// window.location.pathname is the literal filesystem path, not "/" —
// BrowserRouter can't match any route against that and renders nothing.
// HashRouter (matching on the URL fragment) works regardless of the
// underlying file:// path. The hosted web build is always http(s), so this
// only switches behavior for the packaged app, keeping clean URLs on the web.
const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter

// Electron's BrowserWindow (client/electron/main.ts) sets no explicit
// `title`, so it follows document.title automatically, live, including
// updates after the initial load — no IPC needed to keep it in sync. Once
// a shop is set up and logged into, the window/tab title becomes that
// shop's own name instead of the generic brand name; before that (no
// session yet, or on the hosted web build's login screen) it falls back to
// common:appName, matching the same fallback Sidebar.tsx uses.
function DocumentTitleSync() {
  const { staff } = useAuth()
  useEffect(() => {
    document.title = staff?.locationName ?? i18n.t('common:appName')
  }, [staff?.locationName])
  return null
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Router>
          <DocumentTitleSync />
          <AppRouter />
        </Router>
      </ToastProvider>
    </QueryClientProvider>
  )
}
