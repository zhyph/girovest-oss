import { Calendar, dateFnsLocalizer } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import type { Allocation } from '../allocations/allocationSchemas.ts'

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
}: {
  allocations: Allocation[]
  dateField: 'checkoutDate' | 'dueDate'
  onSelectDay: (date: Date) => void
  productNames: Map<string, string>
}) {
  const events = allocations.map((allocation) => ({
    title: productNames.get(allocation.productId) ?? allocation.productId,
    start: new Date(allocation[dateField]),
    end: new Date(allocation[dateField]),
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
        onSelectEvent={(event) => onSelectDay(event.start)}
        onSelectSlot={(slot) => onSelectDay(slot.start)}
        selectable
        culture="pt-BR"
      />
    </div>
  )
}
