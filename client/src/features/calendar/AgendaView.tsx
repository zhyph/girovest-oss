import { useTranslation } from 'react-i18next'
import { parseDateOnly, formatDate } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import type { Allocation } from '../allocations/allocationSchemas.ts'

type Group = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later'
const GROUP_ORDER: Group[] = ['overdue', 'today', 'tomorrow', 'thisWeek', 'later']

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function groupFor(date: Date, today: Date): Group {
  const dayMs = 24 * 60 * 60 * 1000
  const diffDays = Math.round((startOfDay(date).getTime() - startOfDay(today).getTime()) / dayMs)
  if (diffDays < 0) return 'overdue'
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'tomorrow'
  if (diffDays <= 6) return 'thisWeek'
  return 'later'
}

export function AgendaView({
  allocations,
  dateField,
  productNames,
  clientNames,
}: {
  allocations: Allocation[]
  dateField: 'checkoutDate' | 'dueDate'
  productNames: Map<string, string>
  clientNames: Map<string, string>
}) {
  const { t } = useTranslation('calendarScreen')
  const { locale } = useLocale()

  if (allocations.length === 0) {
    return <p className="text-muted-text">{t('empty')}</p>
  }

  const sorted = [...allocations].sort(
    (a, b) => parseDateOnly(a[dateField]).getTime() - parseDateOnly(b[dateField]).getTime(),
  )

  const today = new Date()
  const grouped = new Map<Group, Allocation[]>()
  for (const allocation of sorted) {
    const group = groupFor(parseDateOnly(allocation[dateField]), today)
    const bucket = grouped.get(group) ?? []
    bucket.push(allocation)
    grouped.set(group, bucket)
  }

  return (
    <div className="flex flex-col gap-4">
      {GROUP_ORDER.filter((group) => grouped.has(group)).map((group) => (
        <div key={group} className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-text">{t(`groups.${group}`)}</h2>
          {grouped.get(group)!.map((allocation) => (
            <div key={allocation.id} className="flex justify-between rounded-md border border-border-soft p-2 text-sm">
              <div className="flex flex-col">
                <span>{productNames.get(allocation.productId) ?? allocation.productId}</span>
                <span className="text-xs text-muted-text">
                  {clientNames.get(allocation.clientId) ?? allocation.clientId}
                </span>
              </div>
              <span className="text-muted-text">{formatDate(parseDateOnly(allocation[dateField]), locale, { day: '2-digit', month: '2-digit' })}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
