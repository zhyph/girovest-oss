import { Component, type ReactNode } from 'react'
import i18n from '../i18n.ts'
import { Button } from './ui/button.tsx'

interface ChunkErrorBoundaryProps {
  children: ReactNode
}

interface ChunkErrorBoundaryState {
  hasError: boolean
}

// Route/chunk code (app/router.tsx, lazy-loaded pages) can fail to load —
// a stale asset hash after a redeploy with a tab still open, a truncated
// download, offline mid-navigation. React.lazy surfaces that as a render-time
// throw, which without a boundary here unmounts the whole app to a blank
// white screen instead of a recoverable message.
export class ChunkErrorBoundary extends Component<ChunkErrorBoundaryProps, ChunkErrorBoundaryState> {
  state: ChunkErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ChunkErrorBoundaryState {
    return { hasError: true }
  }

  // Explicit, not relying on React's own default console.error of caught
  // errors: this guarantees the message and stack are the ones forwarded to
  // main.log (see attachConsoleLogging in electron/main.ts), regardless of
  // React version/build differences in what it logs by default.
  componentDidCatch(error: Error): void {
    console.error('ChunkErrorBoundary caught:', error.message, error.stack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-sm text-muted-foreground">{i18n.t('common:errors.chunkLoadFailed')}</p>
          <Button type="button" onClick={() => window.location.reload()}>
            {i18n.t('common:actions.reload')}
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
