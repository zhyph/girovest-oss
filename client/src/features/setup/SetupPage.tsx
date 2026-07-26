import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Card, CardBody, CardHeader } from '../../components/ui/card.tsx'
import { useCompleteSetup } from '../../lib/useSetup.ts'
import { useAuth } from '../../lib/useAuth.ts'
import { showSuccessToast } from '../../lib/toast.ts'
import { setupSchema, type SetupFormValues } from './setupSchema.ts'

export function SetupPage() {
  const { t } = useTranslation(['setup', 'common'])
  const completeSetup = useCompleteSetup()
  const { login } = useAuth()
  const navigate = useNavigate()
  const [errorCode, setErrorCode] = useState<string | null>(null)

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
    } catch (error) {
      setErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
      return
    }
    // The shop now exists either way, so a hiccup logging in automatically
    // shouldn't read as "setup failed" — fall back to the login screen
    // instead of surfacing a setup error for an already-created shop.
    try {
      await login(values.ownerLogin, values.ownerPassword)
      showSuccessToast(t('setup:createdSuccess', { shopName: values.shopName }))
      navigate('/', { replace: true })
    } catch {
      navigate('/login', { replace: true })
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="text-center">
        <div className="text-2xl font-semibold text-primary">{t('common:appName', { ns: 'common' })}</div>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">{t('setup:intro')}</p>
      </div>
      <Card className="w-96">
        <CardHeader>
          <h1 className="text-lg font-semibold">{t('setup:title')}</h1>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t('setup:sections.shop')}
              </legend>
              <label className="flex flex-col gap-1 text-sm">
                {t('setup:shopNameField')}
                <Input
                  {...register('shopName')}
                  aria-invalid={errors.shopName ? true : undefined}
                  aria-describedby={errors.shopName ? 'shopName-error' : undefined}
                />
                {errors.shopName && (
                  <span id="shopName-error" className="text-xs text-destructive">
                    {t('setup:validation.shopNameRequired')}
                  </span>
                )}
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t('setup:shopAddressField')}
                <Input
                  {...register('shopAddress')}
                  aria-invalid={errors.shopAddress ? true : undefined}
                  aria-describedby={errors.shopAddress ? 'shopAddress-error' : undefined}
                />
                {errors.shopAddress && (
                  <span id="shopAddress-error" className="text-xs text-destructive">
                    {t('setup:validation.shopAddressRequired')}
                  </span>
                )}
              </label>
            </fieldset>
            <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
              <legend className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t('setup:sections.account')}
              </legend>
              <label className="flex flex-col gap-1 text-sm">
                {t('setup:ownerNameField')}
                <Input
                  {...register('ownerName')}
                  aria-invalid={errors.ownerName ? true : undefined}
                  aria-describedby={errors.ownerName ? 'ownerName-error' : undefined}
                />
                {errors.ownerName && (
                  <span id="ownerName-error" className="text-xs text-destructive">
                    {t('setup:validation.ownerNameRequired')}
                  </span>
                )}
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t('setup:ownerLoginField')}
                <Input
                  {...register('ownerLogin')}
                  aria-invalid={errors.ownerLogin ? true : undefined}
                  aria-describedby={errors.ownerLogin ? 'ownerLogin-error' : undefined}
                />
                {errors.ownerLogin && (
                  <span id="ownerLogin-error" className="text-xs text-destructive">
                    {t('setup:validation.ownerLoginRequired')}
                  </span>
                )}
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t('setup:ownerPasswordField')}
                <Input
                  type="password"
                  {...register('ownerPassword')}
                  aria-invalid={errors.ownerPassword ? true : undefined}
                  aria-describedby={errors.ownerPassword ? 'ownerPassword-error' : undefined}
                />
                {errors.ownerPassword && (
                  <span id="ownerPassword-error" className="text-xs text-destructive">
                    {t('setup:validation.ownerPasswordTooShort')}
                  </span>
                )}
              </label>
            </fieldset>
            {errorCode && (
              <p className="text-sm text-destructive">
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
