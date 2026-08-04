import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar, dateFnsLocalizer } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
// Must come after the library stylesheet: the overrides win by order at
// equal specificity, and both ride this lazy chunk together.
import './rbc-theme.css'
import { parseDateOnly } from '../../lib/date.ts'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

// Note: unlike the calendar's chrome (localized through i18n below), the date
// formatting itself is pinned to date-fns' pt-BR here and via culture="pt-BR"
// on <Calendar>. Adding a second locale bundle would mean rebuilding this
// localizer per locale rather than at module scope.
function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  )
}

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: ptBR }),
  getDay,
  locales: { 'pt-BR': ptBR },
})

export function MonthView({
  allocations,
  dateField,
  onSelectDay,
  productNames,
  date,
  selectedDay,
  onNavigate,
}: {
  allocations: Allocation[]
  dateField: 'checkoutDate' | 'dueDate'
  onSelectDay: (date: Date) => void
  productNames: Map<string, string>
  // Retained so CalendarPage can pass the same lookup maps to every
  // calendar surface; the grid itself only needs the names.
  products?: Map<string, Product>
  clientNames?: Map<string, string>
  date: Date
  selectedDay: Date | null
  onNavigate: (date: Date) => void
}) {
  const { t } = useTranslation('calendarScreen')

  // Overrides react-big-calendar's built-in English strings. `showMore` gets
  // the number of events the cell could not fit, not the day total. The
  // navigation labels stay mapped even though the library's toolbar is
  // switched off below, because rbc still uses them for the grid's own
  // aria labels.
  const messages = useMemo(
    () => ({
      today: t('rbc.today'),
      previous: t('rbc.previous'),
      next: t('rbc.next'),
      month: t('rbc.month'),
      showMore: (count: number) => t('rbc.showMore', { count }),
    }),
    [t],
  )

  const events = allocations.map((allocation) => ({
    title: productNames.get(allocation.productId) ?? allocation.productId,
    start: parseDateOnly(allocation[dateField]),
    end: parseDateOnly(allocation[dateField]),
    allDay: true,
    resource: allocation,
  }))

  return (
    <div className="h-full min-h-125">
      <Calendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        views={['month']}
        date={date}
        // The library's own Hoje/Anterior/Próximo toolbar is switched off:
        // it was the third control surface competing for the same job, and
        // period navigation now lives once, in the page's control strip.
        toolbar={false}
        onNavigate={onNavigate}
        onSelectEvent={(event) => onSelectDay(event.start)}
        onSelectSlot={(slot) => onSelectDay(slot.start)}
        onDrillDown={(drillDate) => onSelectDay(drillDate)}
        // "+N mais" used to open a dialog listing the day. Selecting the day
        // fills the side panel with the same list instead, so the overflow
        // affordance and the day affordance lead to one place rather than
        // two different ones.
        onShowMore={(_dayEvents, day) => onSelectDay(day)}
        doShowMoreDrillDown={false}
        dayPropGetter={(day) =>
          selectedDay && isSameDay(day, selectedDay) ? { className: 'rbc-day-selected' } : {}
        }
        selectable
        culture="pt-BR"
        messages={messages}
      />
    </div>
  )
}
