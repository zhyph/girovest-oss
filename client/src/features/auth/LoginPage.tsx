import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Link } from 'react-router'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Card, CardBody, CardHeader } from '../../components/ui/card.tsx'
import { useAuth } from '../../lib/useAuth.ts'
import { useSetupStatus } from '../../lib/useSetup.ts'
import { RecoveryCodeReveal } from '../../components/RecoveryCodeReveal.tsx'

export function LoginPage() {
  const { t } = useTranslation(['auth', 'common'])
  const { login, isLoggedIn } = useAuth()
  const setupStatus = useSetupStatus()
  const [loginValue, setLoginValue] = useState('')
  const [password, setPassword] = useState('')
  const [errorCode, setErrorCode] = useState<string | null>(null)
  // Set only for an account that predates recovery codes: the server backfills
  // one on this exact successful login (see authRoutes.ts) and this is the
  // only time it will ever be handed back, so it has to be shown before
  // moving on — even though isLoggedIn is already true at this point.
  const [backfilledCode, setBackfilledCode] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErrorCode(null)
    try {
      const recoveryCode = await login(loginValue, password)
      if (recoveryCode) setBackfilledCode(recoveryCode)
    } catch (error) {
      setErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    }
  }

  // Checked before isLoggedIn below on purpose: login() already flipped
  // isLoggedIn true by the time backfilledCode is set, and the reveal has to
  // win that race or it would never render at all.
  if (backfilledCode) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-80">
          <CardHeader>
            <h1 className="text-lg font-semibold">{t('auth:recoveryCode.title')}</h1>
          </CardHeader>
          <CardBody>
            <RecoveryCodeReveal code={backfilledCode} onContinue={() => setBackfilledCode(null)} />
          </CardBody>
        </Card>
      </div>
    )
  }

  // Once login() resolves, isLoggedIn flips true (react-query's cache update
  // for the ['auth', 'me'] key re-renders this component). Nothing else
  // navigates away from /login on success, so this page has to redirect
  // itself — /login isn't nested under ProtectedRoute, which only guards
  // against unauthenticated access to the other routes, not the reverse.
  if (isLoggedIn) {
    return <Navigate to="/" replace />
  }

  if (setupStatus.data?.needsSetup) {
    return <Navigate to="/configurar-loja" replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-80">
        <CardHeader>
          <h1 className="text-lg font-semibold">{t('auth:loginTitle')}</h1>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t('auth:loginField')}
              <Input value={loginValue} onChange={(e) => setLoginValue(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('auth:passwordField')}
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {errorCode && (
              <p className="text-sm text-destructive">
                {t(`auth:errors.${errorCode}`, { defaultValue: t('common:errors.UNKNOWN') })}
              </p>
            )}
            <Button type="submit">{t('auth:submit')}</Button>
            <Link to="/recuperar-senha" className="text-center text-sm text-muted-foreground hover:text-foreground">
              {t('auth:forgotPassword')}
            </Link>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}
