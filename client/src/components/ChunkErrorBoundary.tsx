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

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-sm text-muted-text">{i18n.t('common:errors.chunkLoadFailed')}</p>
          <Button type="button" onClick={() => window.location.reload()}>
            {i18n.t('common:actions.reload')}
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
