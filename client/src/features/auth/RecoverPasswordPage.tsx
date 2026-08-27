import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Card, CardBody, CardHeader } from '../../components/ui/card.tsx'
import { RecoveryCodeReveal } from '../../components/RecoveryCodeReveal.tsx'
import { apiFetch } from '../../lib/api.ts'

/**
 * Self-service "Esqueci minha senha", reachable from the login screen
 * itself: a support contact behind Settings is no help when Settings sits
 * behind the very login that's broken. Works fully offline (no email/SMS):
 * the recovery code shown once at setup (or after the previous use of this
 * screen) is the only credential needed.
 */
export function RecoverPasswordPage() {
  const { t } = useTranslation(['auth', 'common'])
  const navigate = useNavigate()
  const [login, setLogin] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Set on success, showing the freshly-rotated code in place of the form —
  // the old code just used is dead the moment it worked (see recoveryCodes.ts).
  const [nextRecoveryCode, setNextRecoveryCode] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErrorCode(null)
    if (newPassword.length < 8) {
      setErrorCode('VALIDATION_ERROR')
      return
    }
    if (newPassword !== confirmPassword) {
      setErrorCode('PASSWORD_MISMATCH')
      return
    }
    setIsSubmitting(true)
    try {
      // Unauthenticated by design (nothing to log out of), and a 401 here is
      // "wrong code", not "session expired" -- same reasoning as login()'s
      // own calls in useAuth.ts. See ApiFetchOptions in api.ts.
      const result = await apiFetch<{ recoveryCode: string }>(
        '/api/auth/recover',
        { method: 'POST', body: JSON.stringify({ login, recoveryCode, newPassword }) },
        { suppressAuthLogoutEvent: true },
      )
      setNextRecoveryCode(result.recoveryCode)
    } catch (error) {
      setErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-80">
        <CardHeader>
          <h1 className="text-lg font-semibold">
            {nextRecoveryCode ? t('auth:recoveryCode.title') : t('auth:recover.title')}
          </h1>
        </CardHeader>
        <CardBody>
          {nextRecoveryCode ? (
            <RecoveryCodeReveal code={nextRecoveryCode} onContinue={() => navigate('/login', { replace: true })} />
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t('auth:recover.help')}</p>
              <label className="flex flex-col gap-1 text-sm">
                {t('auth:recover.loginField')}
                <Input value={login} onChange={(e) => setLogin(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t('auth:recover.codeField')}
                <Input value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t('auth:recover.newPasswordField')}
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t('auth:recover.confirmPasswordField')}
                <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </label>
              {errorCode && (
                <p className="text-sm text-destructive">
                  {errorCode === 'PASSWORD_MISMATCH'
                    ? t('auth:recover.passwordMismatch')
                    : t([`auth:recover.errors.${errorCode}`, `common:errors.${errorCode}`, 'common:errors.UNKNOWN'])}
                </p>
              )}
              <Button type="submit" disabled={isSubmitting}>
                {t('auth:recover.submit')}
              </Button>
              <Link
                to="/recuperar-senha/suporte"
                className="text-center text-sm text-muted-foreground hover:text-foreground"
              >
                {t('auth:recover.noCode')}
              </Link>
              <Link to="/login" className="text-center text-sm text-muted-foreground hover:text-foreground">
                {t('auth:recover.backToLogin')}
              </Link>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
