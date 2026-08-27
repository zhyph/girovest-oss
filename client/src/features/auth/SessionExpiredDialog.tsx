import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog.tsx'
import { useAuth } from '../../lib/useAuth.ts'
import { useSessionExpiry } from '../../lib/SessionExpiryContext.tsx'
import { RecoveryCodeReveal } from '../../components/RecoveryCodeReveal.tsx'

/**
 * Re-authenticate without leaving the screen.
 *
 * The point is what does NOT happen: nothing below this dialog unmounts, so a
 * half-filled contract, an open drawer and an unsaved photo order are all
 * still there when she gets back in. Going to /login instead threw all of it
 * away, and the 401 that triggered it was frequently a background timer she
 * had no idea was running.
 *
 * Deliberately not dismissible by Escape or a backdrop click: every request
 * behind it will fail until the session is re-established, so closing it would
 * only produce a screen that silently does nothing. The way out is "Sair",
 * which is the old behaviour, chosen rather than imposed.
 */
export function SessionExpiredDialog() {
  const { t } = useTranslation(['auth', 'common'])
  const { staff, login, logout } = useAuth()
  const { clearExpiry } = useSessionExpiry()
  const [password, setPassword] = useState('')
  const [loginValue, setLoginValue] = useState('')
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  /**
   * Set only when this re-auth happens to be the account's FIRST successful
   * password login — the server backfills a recovery code on that login and,
   * by its own design, hands it back exactly once and never again. Discarding
   * the return value of login() here would have minted it, hashed it, stored
   * it, and lost the plaintext forever. Reachable because a session can be
   * established by the setup flow without ever going through /login.
   */
  const [backfilledCode, setBackfilledCode] = useState<string | null>(null)

  // `staff` is still in the query cache from before the session lapsed, so the
  // account can usually be named and only the password asked for. It can be
  // absent (a hard reload landed straight into an expired session), and then
  // both fields are needed.
  const knownLogin = staff?.login ?? null

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (isSubmitting) return
    setErrorCode(null)
    setIsSubmitting(true)
    try {
      const recoveryCode = await login(knownLogin ?? loginValue, password)
      setPassword('')
      // The reveal has to win this race: clearExpiry() unmounts the dialog.
      if (recoveryCode) {
        setBackfilledCode(recoveryCode)
        return
      }
      clearExpiry()
    } catch (error) {
      setErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleLeave() {
    // Confirmed, because this button sits directly beside help text promising
    // that nothing she was filling in has been lost — and it is the one
    // control here that makes that untrue. useUnsavedChangesGuard is
    // drawer-scoped and does not intercept router navigation.
    if (!window.confirm(t('auth:sessionExpiredDialog.confirmLeave'))) return
    clearExpiry()
    logout()
  }

  if (backfilledCode) {
    return (
      <Dialog open onOpenChange={() => {}}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('auth:recoveryCode.title')}</DialogTitle>
          </DialogHeader>
          <RecoveryCodeReveal
            code={backfilledCode}
            onContinue={() => {
              setBackfilledCode(null)
              clearExpiry()
            }}
          />
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm" aria-describedby="session-expired-help">
        <DialogHeader>
          <DialogTitle>{t('auth:sessionExpiredDialog.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <p id="session-expired-help" className="text-sm text-muted-foreground">
            {t('auth:sessionExpiredDialog.help')}
          </p>
          {knownLogin ? (
            <p className="text-sm">
              <span className="text-muted-foreground">{t('auth:loginField')}: </span>
              <span className="font-medium">{knownLogin}</span>
            </p>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              {t('auth:loginField')}
              <Input value={loginValue} onChange={(event) => setLoginValue(event.target.value)} autoComplete="username" />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            {t('auth:passwordField')}
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              aria-invalid={errorCode ? true : undefined}
              aria-describedby={errorCode ? 'session-expired-error' : undefined}
            />
          </label>
          {errorCode && (
            <span id="session-expired-error" role="alert" className="text-xs text-destructive">
              {t([`auth:errors.${errorCode}`, 'common:errors.UNKNOWN'])}
            </span>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleLeave}>
              {t('common:actions.logout')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('auth:sessionExpiredDialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
