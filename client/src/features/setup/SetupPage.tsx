import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Card, CardBody, CardHeader } from '../../components/ui/card.tsx'
import { useCompleteSetup } from '../../lib/useSetup.ts'
import { setupSchema, type SetupFormValues } from './setupSchema.ts'

export function SetupPage() {
  const { t } = useTranslation(['setup', 'common'])
  const completeSetup = useCompleteSetup()
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SetupFormValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { shopName: '', shopAddress: '', ownerName: '', ownerLogin: '', ownerPassword: '' },
  })

  async function onSubmit(values: SetupFormValues) {
    setErrorCode(null)
    try {
      await completeSetup.mutateAsync(values)
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
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t('setup:shopNameField')}
              <Input {...register('shopName')} />
              {errors.shopName && (
                <span className="text-xs text-red-600">{t('setup:validation.shopNameRequired')}</span>
              )}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('setup:shopAddressField')}
              <Input {...register('shopAddress')} />
              {errors.shopAddress && (
                <span className="text-xs text-red-600">{t('setup:validation.shopAddressRequired')}</span>
              )}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('setup:ownerNameField')}
              <Input {...register('ownerName')} />
              {errors.ownerName && (
                <span className="text-xs text-red-600">{t('setup:validation.ownerNameRequired')}</span>
              )}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('setup:ownerLoginField')}
              <Input {...register('ownerLogin')} />
              {errors.ownerLogin && (
                <span className="text-xs text-red-600">{t('setup:validation.ownerLoginRequired')}</span>
              )}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('setup:ownerPasswordField')}
              <Input type="password" {...register('ownerPassword')} />
              {errors.ownerPassword && (
                <span className="text-xs text-red-600">{t('setup:validation.ownerPasswordTooShort')}</span>
              )}
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
