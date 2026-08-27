import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button.tsx'
import { cn } from '../lib/cn.ts'

interface QueryStateProps {
  isLoading: boolean
  isError: boolean
  /**
   * Whether the query has data to show. When it does, an error is a FAILED
   * REFETCH, not a failed load, and the data stays on screen.
   */
  hasData?: boolean
  /** Refetch the query (or queries) this guards. TanStack's `refetch` fits directly. */
  onRetry: () => void
  /** Screen-specific error copy. Falls back to the shared "could not load" line. */
  errorMessage?: string
  /** What to show while loading. Defaults to a quiet centred line. */
  loading?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * The one place a screen decides between "still loading", "could not load"
 * and "here is the data".
 *
 * Every list screen used to destructure only `isLoading` and `data`, then fall
 * through to `data ?? []`. A failed query and an empty shop therefore rendered
 * identically: "Nenhum cliente cadastrado", with a button offering to create
 * one. The shop owner had no way to tell that the server was down, and no
 * control to try again — the `common:actions.retry` string existed but nothing
 * rendered it outside AppLayout.
 *
 * Put this around the DATA region only, never around the whole screen: the
 * title and toolbar are how she navigates away from a broken screen, so they
 * have to survive the failure that broke it.
 */
export function QueryState({
  isLoading,
  isError,
  hasData = false,
  onRetry,
  errorMessage,
  loading,
  className,
  children,
}: QueryStateProps) {
  const { t } = useTranslation('common')

  /*
   * An error only replaces the screen when there is NOTHING to replace.
   *
   * TanStack sets `status: 'error'` unconditionally and leaves `data` intact,
   * so `isError` is equally true for "never loaded" and "reloaded and the
   * reload failed". The app runs on a bare QueryClient — staleTime 0,
   * refetchOnWindowFocus on — so every alt-tab back into the window and every
   * mutation's invalidate refetches these screens. Blanking on `isError`
   * alone meant one server hiccup wiped a perfectly good 300-client list down
   * to an error panel, which is strictly worse than the empty-state bug this
   * component exists to fix. With data present the failure is reported as a
   * banner above it instead.
   *
   * Error still wins over loading: for a query with no data a retry does
   * re-enter `isLoading` (fetchState only resets to pending when data is
   * undefined), and more importantly the multi-query callers — CalendarPage
   * and useDashboard OR several queries together — can genuinely have one
   * pending while another has failed. Reporting "loading" there hides a
   * failure that is not going to resolve itself.
   */
  if (isError && hasData) {
    return (
      <>
        <div
          role="alert"
          className="flex flex-shrink-0 flex-wrap items-center justify-center gap-3 border-b border-destructive/30 bg-destructive-subtle px-4 py-2 text-meta text-destructive-subtle-foreground"
        >
          <span>{errorMessage ?? t('refreshError')}</span>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t('actions.retry')}
          </Button>
        </div>
        {children}
      </>
    )
  }

  if (isError) {
    return (
      <div
        role="alert"
        className={cn('flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center', className)}
      >
        <p className="text-sm text-muted-foreground">{errorMessage ?? t('loadError')}</p>
        <Button variant="secondary" onClick={onRetry}>
          {t('actions.retry')}
        </Button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className={cn('flex flex-1 items-center justify-center px-4 py-10', className)}>
        {loading ?? <p className="text-sm text-muted-foreground">{t('loading')}</p>}
      </div>
    )
  }

  return <>{children}</>
}
