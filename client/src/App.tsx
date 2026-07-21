import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, HashRouter } from 'react-router'
import { AppRouter } from './app/router.tsx'

const queryClient = new QueryClient()

// The packaged Electron app loads index.html via file://, where
// window.location.pathname is the literal filesystem path, not "/" —
// BrowserRouter can't match any route against that and renders nothing.
// HashRouter (matching on the URL fragment) works regardless of the
// underlying file:// path. The hosted web build is always http(s), so this
// only switches behavior for the packaged app, keeping clean URLs on the web.
const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <AppRouter />
      </Router>
    </QueryClientProvider>
  )
}
