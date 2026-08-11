import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { RecoveryCodeReveal } from '../../components/RecoveryCodeReveal.tsx'
import { apiFetch } from '../../lib/api.ts'

/**
 * The way back from the one real gap in the whole recovery-code design: it
 * is only ever shown once (setup, /recover, or a backfilled login), with no
 * persistence of its own -- close the app, crash, or dismiss the screen
 * before reading it, and staff.recoveryCodeHash is already committed with
 * nothing left to show. This lets anyone still logged in mint a fresh one on
 * demand, same rotate-and-reveal shape as every other path that hands one
 * out. Works on both the desktop app and the hosted web build: unlike
 * diagnostics/support-reset, this needs nothing but an authenticated
 * session.
 *
 * Asks for the current password before rotating -- a session token alone
 * (which sliding renewal keeps alive for as long as the app stays open)
 * proves "logged in earlier", not "it's her right now", and this mints a
 * brand new, no-expiry bearer secret. The server enforces the same check
 * independently; this is what keeps the button from being a dead end when it
 * fails.
 */
export function RecoveryCodeRotateSection() {
  const { t } = useTranslation(['settings', 'common'])
  const [isConfirming, setIsConfirming] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [isRotating, setIsRotating] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErrorCode(null)
    setIsRotating(true)
    try {
      // Suppressed for the same reason as every other auth-adjacent call
      // this session touched: a 401 here would otherwise fire the global
      // 'auth:logout' event and navigate to /login out from under a screen
      // that's about to reveal a code -- this form already shows its own
      // wrong-password error locally.
      const result = await apiFetch<{ recoveryCode: string }>(
        '/api/auth/recovery-code/rotate',
        { method: 'POST', body: JSON.stringify({ currentPassword }) },
        { suppressAuthLogoutEvent: true },
      )
      setCode(result.recoveryCode)
      setIsConfirming(false)
      setCurrentPassword('')
    } catch (error) {
      setErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    } finally {
      setIsRotating(false)
    }
  }

  if (code !== null) {
    return <RecoveryCodeReveal code={code} onContinue={() => setCode(null)} />
  }

  if (isConfirming) {
    return (
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {t('recoveryCode.confirmPasswordField')}
          <Input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoFocus
          />
        </label>
        {errorCode && (
          <p className="text-sm text-destructive">
            {t(`recoveryCode.errors.${errorCode}`, { defaultValue: t('common:errors.UNKNOWN') })}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isRotating || currentPassword === ''}>
            {t('recoveryCode.rotate')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isRotating}
            onClick={() => {
              setIsConfirming(false)
              setCurrentPassword('')
              setErrorCode(null)
            }}
          >
            {t('common:actions.cancel', { ns: 'common' })}
          </Button>
        </div>
      </form>
    )
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => setIsConfirming(true)}>
      {t('recoveryCode.rotate')}
    </Button>
  )
}
