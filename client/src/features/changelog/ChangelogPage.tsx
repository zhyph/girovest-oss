import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ScreenTitle } from '../../components/ui/toolbar.tsx'
import { Badge, type BadgeTone } from '../../components/ui/badge.tsx'
import { formatDate, parseDateOnly } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { markChangelogSeen } from '../../lib/changelogSeen.ts'
import { RELEASES, CURRENT_VERSION, type ChangeKind } from './changelogData.ts'

const KIND_TONE: Record<ChangeKind, BadgeTone> = {
  new: 'success',
  improved: 'accent',
  fixed: 'warning',
}

export function ChangelogPage() {
  const { t } = useTranslation('changelog')
  const { locale } = useLocale()

  // Opening this page IS the acknowledgement — whether someone got here from
  // the banner or from Configurações, either way they have now seen what
  // changed, so the banner should not ask again for this version.
  useEffect(() => {
    if (CURRENT_VERSION) markChangelogSeen(CURRENT_VERSION)
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScreenTitle>{t('title')}</ScreenTitle>
      <p className="mb-5 max-w-[60ch] flex-shrink-0 text-sm text-muted-foreground">{t('subtitle')}</p>
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto pb-8">
        {RELEASES.map((release) => (
          <section key={release.version} className="flex flex-col gap-4">
            <div className="flex items-baseline gap-3 border-b border-border pb-3">
              <span className="font-mono text-[15px] font-medium text-primary">{release.version}</span>
              <span className="tabular text-[12.5px] text-foreground-subtle">
                {formatDate(parseDateOnly(release.date), locale, { day: '2-digit', month: 'long', year: 'numeric' })}
              </span>
              {release.version === CURRENT_VERSION && (
                <Badge tone="success">{t('installedBadge')}</Badge>
              )}
            </div>

            {release.headline && (
              <p className="max-w-[64ch] text-[14.5px] leading-relaxed text-foreground">{release.headline}</p>
            )}

            <div className="flex flex-col gap-px overflow-hidden rounded-panel border border-border">
              {release.items.map((item, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[92px_1fr] items-baseline gap-4 bg-card px-4 py-3"
                >
                  <Badge tone={KIND_TONE[item.kind]} className="justify-self-start">
                    {t(`kinds.${item.kind}`)}
                  </Badge>
                  <span className="text-[14px] leading-relaxed">{item.text}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
