import { useEffect } from 'react'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { PhoneInput } from '../../components/ui/phone-input.tsx'
import { Input } from '../../components/ui/input.tsx'
import { showErrorToast, showSuccessToast } from '../../lib/toast.ts'
import { useTheme, type ThemePreference } from '../../lib/useTheme.ts'
import { useInstallId } from '../../lib/useInstallId.ts'
import { TOUR_SECTIONS } from '../onboarding/sections.ts'
import { SECTION_ROUTES } from '../onboarding/tours.ts'
import { requestTourReplay } from '../onboarding/tourReplay.ts'
import { locationSettingsSchema, type LocationSettingsFormValues } from './settingsSchemas.ts'
import { useLocationSettings, useUpdateLocationSettings } from './useLocationSettings.ts'

const THEME_OPTIONS: ThemePreference[] = ['system', 'light', 'dark']

export function SettingsPage() {
  const { t } = useTranslation('settings')
  const navigate = useNavigate()
  const { data: settings, isLoading } = useLocationSettings()
  const updateSettings = useUpdateLocationSettings()
  const { theme, setTheme } = useTheme()
  const installId = useInstallId()

  function replayTour(section: (typeof TOUR_SECTIONS)[number]) {
    requestTourReplay(section)
    navigate(SECTION_ROUTES[section])
  }

  // navigator.clipboard is absent in insecure contexts and in some test
  // environments, and the code stays selectable on screen either way: a failure
  // here does not deserve an error toast, it just skips the confirmation.
  const copyInstallId = () => {
    if (installId === null) return
    void navigator.clipboard
      ?.writeText(installId)
      .then(() => showSuccessToast(t('install.copied')))
      .catch(() => undefined)
  }

  const { handleSubmit, control, register, reset } = useForm<LocationSettingsFormValues>({
    resolver: zodResolver(locationSettingsSchema),
    defaultValues: { phone: '', maintenanceBufferDays: 0, connectivityMode: 'lan', clauses: [] },
  })

  useEffect(() => {
    if (settings) {
      reset({
        phone: settings.phone ?? '',
        maintenanceBufferDays: settings.maintenanceBufferDays,
        connectivityMode: settings.connectivityMode,
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
    <div className="flex h-full min-h-0 max-w-2xl flex-col">
      <h1 className="mb-4 flex-shrink-0 text-xl font-semibold">{t('title')}</h1>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2" role="group" aria-labelledby="appearance-label">
            <span id="appearance-label" className="text-sm font-medium">{t('appearance.title')}</span>
            <div className="flex gap-2">
              {THEME_OPTIONS.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={theme === option ? 'primary' : 'secondary'}
                  size="sm"
                  aria-pressed={theme === option}
                  onClick={() => setTheme(option)}
                >
                  {t(`appearance.options.${option}`)}
                </Button>
              ))}
            </div>
          </div>
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
          <label className="flex max-w-xs flex-col gap-1 text-sm">
            {t('fields.maintenanceBufferDays')}
            <Input
              type="number"
              min={0}
              max={60}
              aria-label={t('fields.maintenanceBufferDays')}
              aria-describedby="maintenance-buffer-help"
              {...register('maintenanceBufferDays', { valueAsNumber: true })}
            />
            <span id="maintenance-buffer-help" className="text-xs text-muted-foreground">
              {t('maintenanceBufferHelp')}
            </span>
          </label>
          <div className="flex flex-col gap-2" role="group" aria-labelledby="connectivity-label">
            <span id="connectivity-label" className="text-sm font-medium">{t('connectivity.title')}</span>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" value="lan" {...register('connectivityMode')} />
                {t('connectivity.options.lan')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" value="relay" {...register('connectivityMode')} />
                {t('connectivity.options.relay')}
              </label>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('clauses.title')}</span>
            {clauses.fields.map((field, index) => (
              <div key={field.id} className="flex items-start gap-2">
                <textarea
                  {...register(`clauses.${index}.text`)}
                  aria-label={t('clauses.textFieldAria')}
                  rows={2}
                  className="min-h-[3.5rem] w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground transition-colors [field-sizing:content] hover:border-input-hover focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
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
        {/* Outside the <form> on purpose: this is not editable shop data, it is
            a read-only identifier. Disappears entirely on the web build, where
            there is no installation to identify. */}
        {installId !== null && (
          <div className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
            <span className="text-sm font-medium">{t('install.title')}</span>
            <p className="text-sm text-muted-foreground">{t('install.help')}</p>
            <div className="flex items-center gap-2">
              <code className="select-all rounded-md bg-muted px-2 py-1 font-mono text-xs">{installId}</code>
              <Button type="button" variant="secondary" size="sm" onClick={copyInstallId}>
                {t('install.copy')}
              </Button>
            </div>
          </div>
        )}
        {/* Outside the <form> too: replaying a tour is an action, not a field
            that gets saved. */}
        <div className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
          <span className="text-sm font-medium">{t('tours.title')}</span>
          <p className="text-sm text-muted-foreground">{t('tours.help')}</p>
          <div className="flex flex-col gap-2">
            {TOUR_SECTIONS.map((section) => (
              <div key={section} className="flex items-center justify-between gap-2">
                <span className="text-sm">{t(`common:nav.${section}`, { ns: 'common' })}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => replayTour(section)}
                  aria-label={t('tours.replayAria', { section: t(`common:nav.${section}`, { ns: 'common' }) })}
                >
                  {t('tours.replay')}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
