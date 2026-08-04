import { useTranslation } from 'react-i18next'
import { formatDate } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { CalendarDayItemsList } from './CalendarDayItemsList.tsx'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

export type DaySection = {
  key: string
  label: string
  tone: 'ok' | 'due' | 'danger'
  dateField: 'checkoutDate' | 'dueDate'
  allocations: Allocation[]
}

// One state, one colour — the same three the chips and the day cells use,
// so a piece that reads as "voltando" in the grid reads as "voltando" here.
const TONE_CLASS: Record<DaySection['tone'], string> = {
  ok: 'text-success-foreground',
  due: 'text-warning-foreground',
  danger: 'text-destructive-subtle-foreground',
}

/**
 * The selected day's agenda, as a panel beside the grid rather than a
 * separate screen. This replaces both the old "Ver agenda" screen swap and
 * the "+N mais" dialog: picking a day — or a day that could not fit all its
 * pieces — now fills this panel instead of navigating or opening an overlay.
 */
export function CalendarDayPanel({
  day,
  sections,
  products,
  clientNames,
}: {
  day: Date | null
  sections: DaySection[]
  products: Map<string, Product>
  clientNames: Map<string, string>
}) {
  const { t } = useTranslation('calendarScreen')
  const { locale } = useLocale()

  if (!day) {
    return (
      <div className="p-5">
        <p className="text-meta text-muted-foreground">{t('dayPanel.pickDay')}</p>
      </div>
    )
  }

  const populated = sections.filter((section) => section.allocations.length > 0)
  const total = populated.reduce((sum, section) => sum + section.allocations.length, 0)

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-0.5 border-b border-border px-5 py-4">
        <span className="text-heading text-foreground">
          {formatDate(day, locale, { weekday: 'long', day: '2-digit', month: 'long' })}
        </span>
        <span className="text-meta text-muted-foreground">
          {total === 0 ? t('dayPanel.empty') : t('dayPanel.summary', { count: total })}
        </span>
      </div>

      {populated.map((section) => (
        <div key={section.key} className="flex flex-col gap-2.5 border-b border-border px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className={`text-label uppercase ${TONE_CLASS[section.tone]}`}>{section.label}</span>
            <span className="tabular text-xs text-foreground-subtle">{section.allocations.length}</span>
          </div>
          <CalendarDayItemsList
            allocations={section.allocations}
            products={products}
            clientNames={clientNames}
            dateField={section.dateField}
          />
        </div>
      ))}
    </div>
  )
}
