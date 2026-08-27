import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate } from 'react-router'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Card, CardBody, CardHeader } from '../../components/ui/card.tsx'
import { RecoveryCodeReveal } from '../../components/RecoveryCodeReveal.tsx'
import { apiFetch } from '../../lib/api.ts'
import { useSupportPasswordReset, type SupportPasswordResetResult } from '../../lib/useSupportPasswordReset.ts'

/**
 * Layer 2 of password recovery: what's left when the recovery code shown by
 * RecoveryCodeReveal is ALSO lost. A human on the other end (the licensor,
 * verifying identity by phone before approving in /admin) replaces the code
 * as the thing that proves who she is -- see
 * infra/update-proxy/src/lib/passwordReset.ts for the full design.
 */
export function SupportResetPage() {
  const { t } = useTranslation(['auth', 'common'])
  const navigate = useNavigate()
  const { request, available } = useSupportPasswordReset()

  const [login, setLogin] = useState('')
  const [status, setStatus] = useState<SupportPasswordResetResult | null>(null)
  const [isRequesting, setIsRequesting] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [nextRecoveryCode, setNextRecoveryCode] = useState<string | null>(null)

  async function doRequest() {
    setIsRequesting(true)
    try {
      setStatus(await request(login))
    } finally {
      setIsRequesting(false)
    }
  }

  function handleRequestSubmit(event: FormEvent) {
    event.preventDefault()
    void doRequest()
  }

  async function handleFinalize(event: FormEvent) {
    event.preventDefault()
    if (status?.status !== 'approved') return
    setErrorCode(null)
    if (newPassword.length < 8) {
      setErrorCode('VALIDATION_ERROR')
      return
    }
    if (newPassword !== confirmPassword) {
      setErrorCode('PASSWORD_MISMATCH')
      return
    }
    setIsFinalizing(true)
    try {
      const result = await apiFetch<{ recoveryCode: string }>(
        '/api/auth/reset-with-support-token',
        { method: 'POST', body: JSON.stringify({ login, token: status.token, newPassword }) },
        { suppressAuthLogoutEvent: true },
      )
      setNextRecoveryCode(result.recoveryCode)
    } catch (error) {
      setErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    } finally {
      setIsFinalizing(false)
    }
  }

  if (!available) {
    // Hosted web build, or a build with no activation config: there is no
    // possible ticket this screen could ever obtain. Redirect rather than
    // show a dead end with fields that can never succeed.
    return <Navigate to="/recuperar-senha" />
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-80">
        <CardHeader>
          <h1 className="text-lg font-semibold">
            {nextRecoveryCode
              ? t('auth:recoveryCode.title')
              : status?.status === 'approved'
                ? t('auth:recover.title')
                : status?.status === 'pending'
                  ? t('auth:supportReset.pendingTitle')
                  : t('auth:supportReset.title')}
          </h1>
        </CardHeader>
        <CardBody>
          {nextRecoveryCode ? (
            <RecoveryCodeReveal code={nextRecoveryCode} onContinue={() => navigate('/login', { replace: true })} />
          ) : status?.status === 'approved' ? (
            <form onSubmit={handleFinalize} className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t('auth:supportReset.approvedHelp')}</p>
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
              <Button type="submit" disabled={isFinalizing}>
                {t('auth:supportReset.finalize')}
              </Button>
            </form>
          ) : status?.status === 'pending' ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t('auth:supportReset.pendingHelp')}</p>
              {status.code && (
                <div className="select-all rounded-md border border-dashed border-border bg-muted px-4 py-3 text-center font-mono text-lg tracking-wide">
                  {status.code}
                </div>
              )}
              <Button type="button" onClick={() => void doRequest()} disabled={isRequesting}>
                {t('auth:supportReset.retryButton')}
              </Button>
              {/* The Worker creates a pending record for ANY non-empty login,
                  typo or not, and it can never be approved if it doesn't
                  match a real account -- there has to be a way back to fix
                  it, not just "retry the same thing forever". */}
              <Button type="button" variant="secondary" onClick={() => setStatus(null)} disabled={isRequesting}>
                {t('auth:supportReset.editLogin')}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleRequestSubmit} className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t('auth:supportReset.help')}</p>
              <label className="flex flex-col gap-1 text-sm">
                {t('auth:recover.loginField')}
                <Input value={login} onChange={(e) => setLogin(e.target.value)} />
              </label>
              {status?.status === 'denied' && <p className="text-sm text-destructive">{t('auth:supportReset.denied')}</p>}
              {status?.status === 'unreachable' && (
                <p className="text-sm text-destructive">{t('auth:supportReset.unreachable')}</p>
              )}
              <Button type="submit" disabled={isRequesting || login.trim() === ''}>
                {t('auth:supportReset.requestButton')}
              </Button>
              <Link to="/recuperar-senha" className="text-center text-sm text-muted-foreground hover:text-foreground">
                {t('auth:supportReset.backToRecover')}
              </Link>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
