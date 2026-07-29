import { Component, type ReactNode } from 'react'
import i18n from '../i18n.ts'
import { Button } from './ui/button.tsx'

interface ChunkErrorBoundaryProps {
  children: ReactNode
}

interface ChunkErrorBoundaryState {
  error: Error | null
}

// Bundlers don't standardize an error type for a dynamic import failing to
// load (stale asset hash after a redeploy with a tab still open, a truncated
// download, offline mid-navigation) -- recognizing the case is limited to
// matching known message text from Vite/rollup's generated import wrappers.
// A false negative here just falls through to the generic message below, so
// an imprecise match costs wording, not functionality.
function isChunkLoadError(error: Error): boolean {
  return /chunk|dynamically imported module/i.test(error.message)
}

// Mounted both around the router (app/router.tsx, for the chunk-load case
// above) and at the app root (main.tsx): App() also renders providers, sync
// components, and the toaster outside the router, and any render error left
// uncaught there unmounts the whole React tree with nothing left to paint
// over Electron's window backgroundColor (electron/main.ts) -- a solid,
// blank screen instead of a crash the shop can act on (reload).
export class ChunkErrorBoundary extends Component<ChunkErrorBoundaryProps, ChunkErrorBoundaryState> {
  state: ChunkErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ChunkErrorBoundaryState {
    return { error }
  }

  // Explicit, not relying on React's own default console.error of caught
  // errors: this guarantees the message and stack are the ones forwarded to
  // main.log (see attachConsoleLogging in electron/main.ts), regardless of
  // React version/build differences in what it logs by default.
  componentDidCatch(error: Error): void {
    console.error('ChunkErrorBoundary caught:', error.message, error.stack)
  }

  render() {
    const { error } = this.state
    if (error) {
      const messageKey = isChunkLoadError(error) ? 'chunkLoadFailed' : 'unexpected'
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-sm text-muted-foreground">{i18n.t(`common:errors.${messageKey}`)}</p>
          <Button type="button" onClick={() => window.location.reload()}>
            {i18n.t('common:actions.reload')}
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
