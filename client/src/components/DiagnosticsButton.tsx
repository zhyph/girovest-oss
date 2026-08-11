import { Bug } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button.tsx'
import { useSendDiagnostics } from '../lib/useSendDiagnostics.ts'
import { showErrorToast, showSuccessToast } from '../lib/toast.ts'

/**
 * Reachable from anywhere, logged in or not.
 *
 * The incident this was built for was a login that failed silently: Settings
 * (where this also appears, with more explanation -- see SettingsPage.tsx's
 * support section) sits behind the very login that can be broken, so a
 * Settings-only button would have been useless for exactly the case that
 * motivated it. `floating` is what App.tsx mounts at the app root, outside
 * the router, so it shows on the login screen too.
 *
 * Renders nothing on the hosted web build (no local log to send).
 */
export function DiagnosticsButton({ floating = false }: { floating?: boolean }) {
  const { t } = useTranslation(['settings', 'common'])
  const { send, sending, available } = useSendDiagnostics()

  if (!available) return null

  async function handleClick() {
    const ok = await send()
    if (ok) showSuccessToast(t('settings:diagnostics.success'))
    else showErrorToast(t('settings:diagnostics.error'))
  }

  if (floating) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="icon"
        // bottom-16, not bottom-4: the authenticated sidebar (Sidebar.tsx)
        // has its own bottom-left footer (staff name + logout), sitting in
        // roughly the same 0-40px band from the viewport bottom -- bottom-4
        // sat directly on top of it, reported live as overlapping the staff
        // name. The login screen (the other place this needs to be visible)
        // has nothing at bottom-left, so the extra clearance costs nothing
        // there.
        className="fixed bottom-16 left-4 z-50 rounded-full shadow-lg print:hidden"
        onClick={() => void handleClick()}
        disabled={sending}
        title={t('settings:diagnostics.send')}
      >
        <Bug className="size-4" />
      </Button>
    )
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => void handleClick()} disabled={sending}>
      {sending ? t('settings:diagnostics.sending') : t('settings:diagnostics.send')}
    </Button>
  )
}
