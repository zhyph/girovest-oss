import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { useProducts } from '../products/useProducts.ts'
import { useClients } from '../clients/useClients.ts'
import { useCalendarTab, type CalendarTab } from './useCalendar.ts'
import { AgendaView } from './AgendaView.tsx'
import { MonthView } from './MonthView.tsx'

const tabDateField: Record<CalendarTab, 'checkoutDate' | 'dueDate'> = {
  'going-out': 'checkoutDate',
  'due-back': 'dueDate',
  overdue: 'dueDate',
}

function monthRange(anchor: Date) {
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59)
  return { from, to }
}

export function CalendarPage() {
  const { t } = useTranslation('calendarScreen')
  const [tab, setTab] = useState<CalendarTab>('going-out')
  const [view, setView] = useState<'agenda' | 'month'>('agenda')
  const [anchor, setAnchor] = useState(new Date())
  const { from, to } = monthRange(anchor)
  const { data: allocations } = useCalendarTab(tab, from, to)
  const { data: products } = useProducts()
  const { data: clients } = useClients()

  const productNames = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product.name])),
    [products],
  )
  const productsById = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product])),
    [products],
  )
  const clientNames = useMemo(
    () => new Map((clients ?? []).map((client) => [client.id, client.name])),
    [clients],
  )

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button size="sm" variant="secondary" onClick={() => setView(view === 'agenda' ? 'month' : 'agenda')}>
          {view === 'agenda' ? t('viewMonth') : t('viewAgenda')}
        </Button>
      </div>
      <div className="mb-4 flex gap-2">
        <Button size="sm" variant={tab === 'going-out' ? 'primary' : 'secondary'} onClick={() => setTab('going-out')}>
          {t('tabs.goingOut')}
        </Button>
        <Button size="sm" variant={tab === 'due-back' ? 'primary' : 'secondary'} onClick={() => setTab('due-back')}>
          {t('tabs.dueBack')}
        </Button>
        <Button size="sm" variant={tab === 'overdue' ? 'primary' : 'secondary'} onClick={() => setTab('overdue')}>
          {t('tabs.overdue')}
        </Button>
      </div>
      {view === 'agenda' ? (
        <AgendaView
          allocations={allocations ?? []}
          dateField={tabDateField[tab]}
          products={productsById}
          clientNames={clientNames}
        />
      ) : (
        <MonthView
          allocations={allocations ?? []}
          dateField={tabDateField[tab]}
          productNames={productNames}
          date={anchor}
          onNavigate={setAnchor}
          onSelectDay={(date) => {
            setAnchor(date)
            setView('agenda')
          }}
        />
      )}
    </div>
  )
}
