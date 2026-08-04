import { lazy, Suspense, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { RouteFallback } from '../../components/RouteFallback.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDate, parseDateOnly } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { useProducts } from '../products/useProducts.ts'
import { useClients } from '../clients/useClients.ts'
import { useCalendarTab, type CalendarTab } from './useCalendar.ts'
import { AgendaView } from './AgendaView.tsx'
import { CalendarDayPanel, type DaySection } from './CalendarDayPanel.tsx'

// Month is now the default view (below), so MonthView's chunk is needed on
// essentially every /calendario entry. Kick its dynamic import off at module
// scope, as soon as CalendarPage's own chunk evaluates, instead of when React
// first renders <MonthView/>: rendering-time would serialize the two chunk
// fetches into a request waterfall. MonthView (react-big-calendar and its
// stylesheet) still emits as a separate chunk, so it stays out of the
// initial bundle.
const monthViewImport = import('./MonthView.tsx')
// Handle rejection on a branch so a failed fetch during the gap before React
// first renders <MonthView/> is not an unhandled rejection; lazy() reuses the
// same promise, so a real failure still surfaces through
// Suspense/ChunkErrorBoundary when the view renders.
monthViewImport.catch(() => {})
const MonthView = lazy(() => monthViewImport.then((m) => ({ default: m.MonthView })))

const tabDateField: Record<CalendarTab, 'checkoutDate' | 'dueDate'> = {
  'going-out': 'checkoutDate',
  'due-back': 'dueDate',
  overdue: 'dueDate',
}

const TAB_TONE: Record<CalendarTab, DaySection['tone']> = {
  'going-out': 'due',
  'due-back': 'ok',
  overdue: 'danger',
}

const TABS: CalendarTab[] = ['going-out', 'due-back', 'overdue']

const TAB_LABEL_KEY: Record<CalendarTab, string> = {
  'going-out': 'tabs.goingOut',
  'due-back': 'tabs.dueBack',
  overdue: 'tabs.overdue',
}

function monthRange(anchor: Date) {
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59)
  return { from, to }
}

function addMonths(anchor: Date, delta: number) {
  return new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1)
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  )
}

export function CalendarPage() {
  const { t } = useTranslation('calendarScreen')
  const { locale } = useLocale()
  const [tab, setTab] = useState<CalendarTab>('going-out')
  const [view, setView] = useState<'agenda' | 'grid'>('grid')
  const [anchor, setAnchor] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const { from, to } = monthRange(anchor)

  // All three sets are fetched for the visible month, not just the active
  // one. The chips can then show real counts instead of only the set that
  // happens to be selected, and the day panel can say what goes out *and*
  // what comes back on the same day — which is the question the shop
  // actually asks. React Query caches per tab+range, so switching chips
  // re-renders from cache rather than refetching.
  const goingOut = useCalendarTab('going-out', from, to)
  const dueBack = useCalendarTab('due-back', from, to)
  const overdue = useCalendarTab('overdue', from, to)
  const byTab: Record<CalendarTab, ReturnType<typeof useCalendarTab>> = {
    'going-out': goingOut,
    'due-back': dueBack,
    overdue,
  }
  const allocations = byTab[tab].data ?? []

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

  const daySections: DaySection[] = useMemo(() => {
    if (!selectedDay) return []
    return TABS.map((key) => {
      const dateField = tabDateField[key]
      return {
        key,
        label: t(TAB_LABEL_KEY[key]),
        tone: TAB_TONE[key],
        dateField,
        allocations: (byTab[key].data ?? []).filter((allocation) =>
          isSameDay(parseDateOnly(allocation[dateField]), selectedDay),
        ),
      }
    })
    // byTab is rebuilt every render; the query data it wraps is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay, goingOut.data, dueBack.data, overdue.data, t])

  const monthLabel = formatDate(anchor, locale, { month: 'long', year: 'numeric' })

  function goToday() {
    const today = new Date()
    setAnchor(today)
    setSelectedDay(today)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <h1 className="mb-3.5 flex-shrink-0 font-serif text-display">{t('title')}</h1>

      {/*
        One control strip. This screen previously carried three overlapping
        control surfaces for the same job: a button that renamed itself
        between "Ver mês" and "Ver agenda", a separate row of tab buttons,
        and react-big-calendar's own Hoje/Anterior/Próximo toolbar. They are
        merged here — period navigation, the period label, status filters,
        and the view toggle — in one row, in one order.
      */}
      <div className="mb-3.5 flex flex-shrink-0 flex-wrap items-center gap-2.5">
        <div className="flex">
          <button
            type="button"
            onClick={() => setAnchor(addMonths(anchor, -1))}
            aria-label={t('controls.previousMonth')}
            className="inline-flex size-7.5 items-center justify-center rounded-l-control border border-border-strong bg-surface text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() => setAnchor(addMonths(anchor, 1))}
            aria-label={t('controls.nextMonth')}
            className="inline-flex size-7.5 items-center justify-center rounded-r-control border border-l-0 border-border-strong bg-surface text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/*
          `capitalize` would title-case every word and render the pt-BR
          "agosto de 2026" as "Agosto De 2026"; only the first letter
          should lift.
        */}
        <span className="min-w-30 text-[15px] font-semibold first-letter:uppercase">{monthLabel}</span>

        <button
          type="button"
          onClick={goToday}
          className="h-7.5 rounded-control border border-border-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-sunken"
        >
          {t('controls.today')}
        </button>

        <div className="mx-0.5 h-5.5 w-px bg-border" />

        <div className="flex items-center gap-1.5">
          {TABS.map((key) => {
            const active = tab === key
            const count = byTab[key].data?.length ?? 0
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-pressed={active}
                className={cn(
                  'h-7 rounded-full border px-3 text-meta font-medium',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border-strong bg-transparent text-muted-foreground hover:bg-surface-sunken hover:text-foreground',
                )}
              >
                {t(TAB_LABEL_KEY[key])} <span className="tabular opacity-60">{count}</span>
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex rounded-control border border-border-strong bg-surface-sunken p-0.5">
          {(['grid', 'agenda'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-pressed={view === key}
              className={cn(
                'h-6.5 rounded-[4px] px-2.5 text-meta font-medium',
                view === key ? 'bg-surface text-foreground shadow-panel' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`views.${key}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 border-t border-border-strong">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {view === 'agenda' ? (
            <AgendaView
              allocations={allocations}
              dateField={tabDateField[tab]}
              products={productsById}
              clientNames={clientNames}
            />
          ) : (
            <Suspense fallback={<RouteFallback />}>
              <MonthView
                allocations={allocations}
                dateField={tabDateField[tab]}
                productNames={productNames}
                products={productsById}
                clientNames={clientNames}
                date={anchor}
                selectedDay={selectedDay}
                onNavigate={setAnchor}
                onSelectDay={setSelectedDay}
              />
            </Suspense>
          )}
        </div>

        <aside className="min-h-0 w-105 flex-shrink-0 overflow-y-auto border-l border-border-strong">
          <CalendarDayPanel
            day={selectedDay}
            sections={daySections}
            products={productsById}
            clientNames={clientNames}
          />
        </aside>
      </div>
    </div>
  )
}
