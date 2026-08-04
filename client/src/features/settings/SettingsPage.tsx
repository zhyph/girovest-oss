import { useEffect, useState } from 'react'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { ScreenTitle, SectionLabel } from '../../components/ui/toolbar.tsx'
import { cn } from '../../lib/cn.ts'
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
import { BackupSection } from './BackupSection.tsx'
import { hasGirovestBridge } from '../../lib/girovestBridge.ts'

const THEME_OPTIONS: ThemePreference[] = ['system', 'light', 'dark']

/**
 * Five navigable sections instead of one column of eight blocks. The
 * clauses in particular were text boxes loose in the middle of unrelated
 * settings; they are their own section, in the order they print.
 */
const SETTINGS_SECTIONS = ['shop', 'contract', 'backup', 'appearance', 'support'] as const
type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

/**
 * Inactive sections stay mounted and are hidden with the `hidden`
 * attribute rather than unmounted. Three of the five carry fields of the
 * same react-hook-form, and unmounting them would put the form's dirty
 * state and its field array at the mercy of mount order; `hidden` also
 * takes them out of the accessibility tree, so it costs nothing.
 */
function SectionPanel({
  active,
  children,
}: {
  active: boolean
  children: React.ReactNode
}) {
  return (
    <div hidden={!active} className="flex flex-col gap-5">
      {children}
    </div>
  )
}

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

  const [section, setSection] = useState<SettingsSection>('shop')
  const { handleSubmit, control, register, reset, formState } = useForm<LocationSettingsFormValues>({
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
    <div className="relative flex h-full min-h-0 flex-col">
      <ScreenTitle>{t('title')}</ScreenTitle>
      <div className="flex min-h-0 flex-1 border-t border-border-strong">
        <nav
          aria-label={t('title')}
          className="flex w-52 flex-shrink-0 flex-col gap-0.5 border-r border-border p-2.5"
        >
          {SETTINGS_SECTIONS.map((key) => {
            const active = section === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSection(key)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-start gap-px rounded-control px-2.5 py-2 text-left',
                  active
                    ? 'bg-secondary text-secondary-foreground shadow-[inset_2px_0_0_var(--primary)]'
                    : 'text-foreground hover:bg-surface-sunken',
                )}
              >
                <span className="text-[13.5px] font-medium">{t(`sections.${key}`)}</span>
                <span className={cn('text-[11.5px]', active ? 'text-primary' : 'text-foreground-subtle')}>
                  {key === 'contract'
                    ? t('sections.contractHint', { count: clauses.fields.length })
                    : t(`sections.${key}Hint`)}
                </span>
              </button>
            )
          })}
        </nav>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="flex max-w-[41rem] flex-col gap-5 px-6 pt-5 pb-20">
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
        <SectionPanel active={section === 'appearance'}>
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
        </SectionPanel>

        <SectionPanel active={section === 'shop'}>
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
        </SectionPanel>

        <SectionPanel active={section === 'appearance'}>
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
        </SectionPanel>

        <SectionPanel active={section === 'contract'}>
          <div className="flex flex-col gap-2.5">
            <SectionLabel>{t('clauses.title')}</SectionLabel>
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
        </SectionPanel>

        {/*
          One save bar for the whole screen, pinned to the bottom and shown
          only when something has actually changed. The form previously
          ended with a Salvar you had to scroll to find, below whichever of
          the eight blocks you happened to be editing.
        */}
        {formState.isDirty && (
          <div className="absolute right-0 bottom-0 left-52 flex items-center justify-end gap-2.5 border-t border-border-strong bg-surface px-6 py-3 shadow-[0_-8px_20px_-14px_rgb(46_35_32/0.28)]">
            <span className="mr-auto text-meta text-muted-foreground">{t('unsaved')}</span>
            <Button type="button" variant="secondary" onClick={() => reset()}>
              {t('discard')}
            </Button>
            <Button type="submit" disabled={updateSettings.isPending}>
              {t('common:actions.save', { ns: 'common' })}
            </Button>
          </div>
        )}
        </form>
        {/* Outside the <form> on purpose: this is not editable shop data, it is
            a read-only identifier. Disappears entirely on the web build, where
            there is no installation to identify. */}
        <SectionPanel active={section === 'support'}>
        {installId !== null && (
          <div className="flex flex-col gap-2">
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
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <SectionLabel>{t('tours.title')}</SectionLabel>
          <p className="text-sm text-muted-foreground">{t('tours.help')}</p>
          <div className="flex flex-col gap-2">
            {TOUR_SECTIONS.map((tourSection) => (
              <div key={tourSection} className="flex items-center justify-between gap-2">
                <span className="text-sm">{t(`common:nav.${tourSection}`, { ns: 'common' })}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => replayTour(tourSection)}
                  aria-label={t('tours.replayAria', { section: t(`common:nav.${tourSection}`, { ns: 'common' }) })}
                >
                  {t('tours.replay')}
                </Button>
              </div>
            ))}
          </div>
        </div>
        </SectionPanel>

        <SectionPanel active={section === 'backup'}>
          {hasGirovestBridge() && <BackupSection />}
        </SectionPanel>
        </div>
        </div>
      </div>
    </div>
  )
}
