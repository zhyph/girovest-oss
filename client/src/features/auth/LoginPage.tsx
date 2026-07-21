import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Card, CardBody, CardHeader } from '../../components/ui/card.tsx'
import { useAuth } from '../../lib/useAuth.ts'

export function LoginPage() {
  const { t } = useTranslation(['auth', 'common'])
  const { login, isLoggedIn } = useAuth()
  const [loginValue, setLoginValue] = useState('')
  const [password, setPassword] = useState('')
  const [errorCode, setErrorCode] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErrorCode(null)
    try {
      await login(loginValue, password)
    } catch (error) {
      setErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    }
  }

  // Once login() resolves, isLoggedIn flips true (react-query's cache update
  // for the ['auth', 'me'] key re-renders this component). Nothing else
  // navigates away from /login on success, so this page has to redirect
  // itself — /login isn't nested under ProtectedRoute, which only guards
  // against unauthenticated access to the other routes, not the reverse.
  if (isLoggedIn) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream">
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
              <p className="text-sm text-red-600">
                {t(`auth:errors.${errorCode}`, { defaultValue: t('common:errors.UNKNOWN') })}
              </p>
            )}
            <Button type="submit">{t('auth:submit')}</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}
