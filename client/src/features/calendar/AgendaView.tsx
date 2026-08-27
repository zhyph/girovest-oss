import { useTranslation } from 'react-i18next'
import { CalendarDayItemsList } from './CalendarDayItemsList.tsx'
import type { CalendarEntry } from './calendarEntries.ts'
import type { Product } from '../products/productSchemas.ts'

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
  entries,
  products,
  clientNames,
  filter = 'all',
}: {
  entries: CalendarEntry[]
  products: Map<string, Product>
  clientNames: Map<string, string>
  /** Only used to key the lists below, so a chip change restarts them at page 1. */
  filter?: string
}) {
  const { t } = useTranslation('calendarScreen')

  if (entries.length === 0) {
    return <p className="text-muted-foreground">{t('empty')}</p>
  }

  const sorted = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime())

  // Decided once for the whole view, not per group: a group that happens to
  // hold only pieces going out would otherwise drop the tag while the group
  // below it kept it, and the reader would take the difference for meaning.
  const showKind = new Set(entries.map((entry) => entry.kind)).size > 1

  const today = new Date()
  const grouped = new Map<Group, CalendarEntry[]>()
  for (const entry of sorted) {
    const group = groupFor(entry.date, today)
    const bucket = grouped.get(group) ?? []
    bucket.push(entry)
    grouped.set(group, bucket)
  }

  return (
    <div className="flex flex-col gap-4">
      {GROUP_ORDER.filter((group) => grouped.has(group)).map((group) => (
        <div key={group} className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`groups.${group}`)}</h2>
          {/*
            Keyed by FILTER as well as group. `key={group}` alone was inert:
            the wrapping div is already keyed by group, and a key only
            disambiguates siblings — the sole child of a stably-keyed parent
            never remounts. Switching chips left the list parked on page 2 of
            the previous set.
          */}
          <CalendarDayItemsList
            key={`${filter}-${group}`}
            entries={grouped.get(group)!}
            products={products}
            clientNames={clientNames}
            showKind={showKind}
          />
        </div>
      ))}
    </div>
  )
}
