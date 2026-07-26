import { Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Sidebar } from './Sidebar.tsx'
import { Button } from '../components/ui/button.tsx'
import { useAuth } from '../lib/useAuth.ts'
import { useProductPhotoEvents } from '../features/products/useProductPhotoEvents.ts'

export function AppLayout() {
  // Called unconditionally, before either early return below, because React
  // requires every hook to run on every render regardless of which branch
  // this component takes.
  useProductPhotoEvents()

  const { t } = useTranslation('common')
  const { staff, isLoadingStaff, isErrorStaff, refetchStaff, logout } = useAuth()

  // Guards the moment right after a hard reload / deep link: the auth
  // token is already known (ProtectedRoute let us in), but the shop's
  // own name/branding hasn't loaded yet. Rendering the shell before staff
  // arrives is what used to flash the generic "Girovest" label and an
  // empty user block for an instant.
  if (isLoadingStaff) {
    return (
      <div className="flex h-screen items-center justify-center bg-cream">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-500" />
      </div>
    )
  }

  // A non-401 failure (500, dropped connection, server restart) settles
  // the query into an error with no data — `staff` never arrives, so
  // gating only on isLoadingStaff would otherwise strand the user on the
  // spinner above forever, with no nav and no way to log out. Falls back
  // to this same state if `staff` is ever undefined without an explicit
  // error too (e.g. a disabled query), so there's always a way out.
  if (isErrorStaff || !staff) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-cream px-4 text-center">
        <p className="text-sm text-muted-text">{t('profileLoadError')}</p>
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
      <main className="min-h-0 flex-1">
        <div className="mx-auto flex h-full max-w-4xl flex-col p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
