import { useState } from 'react'
import { Calendar, dateFnsLocalizer } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog.tsx'
import { parseDateOnly } from '../../lib/date.ts'
import { CalendarDayItemsList } from './CalendarDayItemsList.tsx'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: ptBR }),
  getDay,
  locales: { 'pt-BR': ptBR },
})

const messages = {
  today: 'Hoje',
  previous: 'Anterior',
  next: 'Próximo',
  month: 'Mês',
}

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
  const [showMoreDay, setShowMoreDay] = useState<{ date: Date; allocations: Allocation[] } | null>(null)

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
        selectable
        culture="pt-BR"
        messages={messages}
      />
      <Dialog open={showMoreDay !== null} onOpenChange={(open) => !open && setShowMoreDay(null)}>
        <DialogContent showCloseButton={true} className="max-w-2xl">
          <DialogTitle className="mb-3 text-base font-semibold text-ink">
            {showMoreDay && new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(showMoreDay.date)}
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
