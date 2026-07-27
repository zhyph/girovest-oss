import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar, dateFnsLocalizer } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
// Must come after the library stylesheet: the overrides win by order at
// equal specificity, and both ride this lazy chunk together.
import './rbc-theme.css'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog.tsx'
import { parseDateOnly, formatDate } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { CalendarDayItemsList } from './CalendarDayItemsList.tsx'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

// Note: unlike the calendar's chrome (localized through i18n below), the date
// formatting itself is pinned to date-fns' pt-BR here and via culture="pt-BR"
// on <Calendar>. Adding a second locale bundle would mean rebuilding this
// localizer per locale rather than at module scope.
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
  products,
  clientNames,
  date,
  onNavigate,
}: {
  allocations: Allocation[]
  dateField: 'checkoutDate' | 'dueDate'
  onSelectDay: (date: Date) => void
  productNames: Map<string, string>
  products: Map<string, Product>
  clientNames: Map<string, string>
  date: Date
  onNavigate: (date: Date) => void
}) {
  const { locale } = useLocale()
  const { t } = useTranslation('calendarScreen')
  const [showMoreDay, setShowMoreDay] = useState<{ date: Date; allocations: Allocation[] } | null>(null)

  // Overrides react-big-calendar's built-in English strings. `showMore` gets
  // the number of events the cell could not fit, not the day total. `month` is
  // unrendered while views={['month']} (rbc hides the view switcher for a
  // single view) but is one line and goes live the moment a second view is added.
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
    <div style={{ height: 500 }}>
      <Calendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        views={['month']}
        date={date}
        onNavigate={onNavigate}
        onSelectEvent={(event) => onSelectDay(event.start)}
        onSelectSlot={(slot) => onSelectDay(slot.start)}
        onDrillDown={(drillDate) => onSelectDay(drillDate)}
        onShowMore={(dayEvents, day) =>
          setShowMoreDay({ date: day, allocations: dayEvents.map((event) => event.resource as Allocation) })
        }
        doShowMoreDrillDown={false}
        selectable
        culture="pt-BR"
        messages={messages}
      />
      <Dialog open={showMoreDay !== null} onOpenChange={(open) => !open && setShowMoreDay(null)}>
        <DialogContent showCloseButton={true} className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
          <DialogTitle className="mb-3 flex-shrink-0 text-base font-semibold text-foreground">
            {showMoreDay && formatDate(showMoreDay.date, locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}
          </DialogTitle>
          {showMoreDay && (
            <CalendarDayItemsList
              allocations={showMoreDay.allocations}
              products={products}
              clientNames={clientNames}
              dateField={dateField}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
