import { Suspense } from 'react'
import { Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import { RouteFallback } from '../components/RouteFallback.tsx'
import { Sidebar } from './Sidebar.tsx'
import { Button } from '../components/ui/button.tsx'
import { useAuth } from '../lib/useAuth.ts'
import { useSessionExpiry } from '../lib/SessionExpiryContext.tsx'
import { useProductPhotoEvents } from '../features/products/useProductPhotoEvents.ts'

export function AppLayout() {
  // Called unconditionally, before either early return below, because React
  // requires every hook to run on every render regardless of which branch
  // this component takes.
  useProductPhotoEvents()

  const { t } = useTranslation('common')
  const { staff, isLoadingStaff, isErrorStaff, refetchStaff, logout } = useAuth()
  const { isExpired } = useSessionExpiry()

  // Guards the moment right after a hard reload / deep link: the auth
  // token is already known (ProtectedRoute let us in), but the shop's
  // own name/branding hasn't loaded yet. Rendering the shell before staff
  // arrives is what used to flash the generic "Girovest" label and an
  // empty user block for an instant.
  if (isLoadingStaff) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-secondary border-t-primary" />
      </div>
    )
  }

  // A non-401 failure (500, dropped connection, server restart) settles
  // the query into an error with no data — `staff` never arrives, so
  // gating only on isLoadingStaff would otherwise strand the user on the
  // spinner above forever, with no nav and no way to log out. Falls back
  // to this same state if `staff` is ever undefined without an explicit
  // error too (e.g. a disabled query), so there's always a way out.
  //
  // `isErrorStaff` is IGNORED while the session is expired, as long as a
  // cached profile is still around to render the shell from. A 401 on /me is
  // the expected state then, not a failure — and taking this branch would
  // unmount Sidebar AND Outlet, destroying the half-filled form the re-auth
  // dialog exists to preserve. The staff query is `retry: false` with
  // TanStack's default `refetchOnWindowFocus`, so the most ordinary way a
  // lapsed session is discovered — she comes back to the machine and clicks
  // the window — went straight through here.
  //
  // `!staff` still wins unconditionally: with no cached profile there is
  // nothing to preserve and nothing to render the shell from.
  if (!staff || (isErrorStaff && !isExpired)) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-sm text-muted-foreground">{t('profileLoadError')}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => refetchStaff()}>
            {t('actions.retry')}
          </Button>
          <Button variant="ghost" onClick={logout}>
            {t('actions.logout')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col lg:flex-row">
      <Sidebar />
      {/*
        The screen occupies the window. This used to be capped at
        `max-w-4xl` (896px) inside a 1600px Electron window, so anything
        that could have sat side by side was stacked into scroll instead —
        the main reason the app read as scattered. The work area also sits
        one surface step lighter than the nav rail, which is what separates
        "where I navigate" from "where I work".
      */}
      <main className="min-h-0 flex-1 bg-surface">
        <div className="flex h-full flex-col p-6">
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  )
}
