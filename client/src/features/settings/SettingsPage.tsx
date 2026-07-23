import { useEffect } from 'react'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { PhoneInput } from '../../components/ui/phone-input.tsx'
import { showErrorToast, showSuccessToast } from '../../lib/toast.ts'
import { locationSettingsSchema, type LocationSettingsFormValues } from './settingsSchemas.ts'
import { useLocationSettings, useUpdateLocationSettings } from './useLocationSettings.ts'

export function SettingsPage() {
  const { t } = useTranslation('settings')
  const { data: settings, isLoading } = useLocationSettings()
  const updateSettings = useUpdateLocationSettings()

  const { handleSubmit, control, register, reset } = useForm<LocationSettingsFormValues>({
    resolver: zodResolver(locationSettingsSchema),
    defaultValues: { phone: '', clauses: [] },
  })

  useEffect(() => {
    if (settings) {
      reset({
        phone: settings.phone ?? '',
        clauses: settings.clauses.map((clause) => ({ text: clause.text })),
      })
    }
  }, [settings, reset])

  const clauses = useFieldArray({ control, name: 'clauses' })

  async function onSubmit(values: LocationSettingsFormValues) {
    try {
      await updateSettings.mutateAsync(values)
      showSuccessToast(t('saved'))
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'UNKNOWN'
      showErrorToast(t(`common:errors.${code}`, { ns: 'common', defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) }))
    }
  }

  if (isLoading) return <div>{t('title')}</div>

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">{t('title')}</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <label className="flex max-w-xs flex-col gap-1 text-sm">
          {t('fields.phone')}
          <Controller
            name="phone"
            control={control}
            render={({ field }) => (
              <PhoneInput value={field.value} onChange={field.onChange} aria-label={t('fields.phone')} />
            )}
          />
        </label>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('clauses.title')}</span>
          {clauses.fields.map((field, index) => (
            <div key={field.id} className="flex items-start gap-2">
              <textarea
                {...register(`clauses.${index}.text`)}
                aria-label={t('clauses.textFieldAria')}
                rows={2}
                className="h-auto min-h-[3.5rem] w-full rounded-md border border-border-soft bg-white px-3 py-2 text-sm text-ink transition-colors hover:border-brand-300 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => clauses.remove(index)}
                aria-label={t('clauses.remove')}
              >
                <X size={16} />
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => clauses.append({ text: '' })}>
            {t('clauses.add')}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={updateSettings.isPending}>
            {t('common:actions.save', { ns: 'common' })}
          </Button>
        </div>
      </form>
    </div>
  )
}
