import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Card, CardBody, CardHeader } from '../../components/ui/card.tsx'
import { useCompleteSetup } from '../../lib/useSetup.ts'

export function SetupPage() {
  const { t } = useTranslation(['setup', 'common'])
  const completeSetup = useCompleteSetup()
  const [shopName, setShopName] = useState('')
  const [shopAddress, setShopAddress] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerLogin, setOwnerLogin] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErrorCode(null)
    try {
      await completeSetup.mutateAsync({ shopName, shopAddress, ownerName, ownerLogin, ownerPassword })
      setDone(true)
    } catch (error) {
      setErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    }
  }

  if (done) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream">
      <Card className="w-96">
        <CardHeader>
          <h1 className="text-lg font-semibold">{t('setup:title')}</h1>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t('setup:shopNameField')}
              <Input value={shopName} onChange={(e) => setShopName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('setup:shopAddressField')}
              <Input value={shopAddress} onChange={(e) => setShopAddress(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('setup:ownerNameField')}
              <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('setup:ownerLoginField')}
              <Input value={ownerLogin} onChange={(e) => setOwnerLogin(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('setup:ownerPasswordField')}
              <Input
                type="password"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
              />
            </label>
            {errorCode && (
              <p className="text-sm text-red-600">
                {t(`setup:errors.${errorCode}`, { defaultValue: t('common:errors.UNKNOWN') })}
              </p>
            )}
            <Button type="submit" disabled={completeSetup.isPending}>
              {t('setup:submit')}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}
