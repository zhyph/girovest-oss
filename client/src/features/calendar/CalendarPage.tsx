import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { RouteFallback } from '../../components/RouteFallback.tsx'
import { QueryState } from '../../components/QueryState.tsx'
import { FilterChip } from '../../components/ui/toolbar.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDate, toIsoDateOnly } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { useProducts } from '../products/useProducts.ts'
import { useClients } from '../clients/useClients.ts'
import { useCalendarTab } from './useCalendar.ts'
import {
  buildEntries,
  dayKey,
  FILTER_LABEL_KEY,
  FILTER_ORDER,
  KIND_ORDER,
  KIND_TONE,
  type AllocationsByKind,
  type CalendarFilter,
} from './calendarEntries.ts'
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

// Both ends are whole calendar days — useCalendarTab sends them as date-only
// strings, so an end-of-day time component would be dropped anyway, and while
// it was still being serialized as an instant it pulled the 1st of the NEXT
// month into this month's range.
function monthRange(anchor: Date) {
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  return { from, to }
}

function addMonths(anchor: Date, delta: number) {
  return new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1)
}

export function CalendarPage() {
  const { t } = useTranslation('calendarScreen')
  const { locale } = useLocale()
  // "Tudo" first, and selected on arrival: the shop opens this screen to see
  // the day, not one direction of it. Narrowing to Saindo or Voltando is the
  // deliberate act, not the starting point.
  const [filter, setFilter] = useState<CalendarFilter>('all')
  const [view, setView] = useState<'agenda' | 'grid'>('grid')
  const [anchor, setAnchor] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const { from, to } = monthRange(anchor)

  /*
   * The day panel reads from the visible month's entries, so paging away left
   * it showing a date no longer on the grid with nothing under it — an empty
   * panel that reads as "nothing happens that day" rather than "you are
   * looking at a different month". Dropping the selection puts the panel back
   * to its own "pick a day" prompt, which is honest.
   *
   * Compared as CALENDAR DAYS, not instants: a selected day can carry a time
   * component while `monthRange` returns local midnight, so an instant
   * comparison dropped a legitimately visible selection on the month's last
   * day. Keyed on the ISO strings for the same reason `monthRange` allocates
   * fresh Dates every render and would otherwise re-run this constantly.
   */
  const fromKey = toIsoDateOnly(from)
  const toKey = toIsoDateOnly(to)
  useEffect(() => {
    setSelectedDay((current) => {
      if (!current) return current
      const key = toIsoDateOnly(current)
      return key < fromKey || key > toKey ? null : current
    })
  }, [fromKey, toKey])

  // All three sets are fetched for the visible month, not just the active
  // one. The chips can then show real counts instead of only the set that
  // happens to be selected, and the day panel can say what goes out *and*
  // what comes back on the same day — which is the question the shop
  // actually asks. React Query caches per tab+range, so switching chips
  // re-renders from cache rather than refetching.
  const goingOut = useCalendarTab('going-out', from, to)
  const dueBack = useCalendarTab('due-back', from, to)
  const overdue = useCalendarTab('overdue', from, to)

  // All three sets feed one picture of the month, so a failure in any of them
  // makes the whole grid wrong rather than partial — an empty Saturday that is
  // really an unanswered request is worse than no calendar at all, because
  // nothing on screen says so. Retry recovers all three together.
  const isError = goingOut.isError || dueBack.isError || overdue.isError
  const isLoading = goingOut.isLoading || dueBack.isLoading || overdue.isLoading
  // Any set having arrived is enough to keep the grid up under a failed
  // refresh; the banner says what is on screen may be behind.
  const hasCalendarData = goingOut.data !== undefined || dueBack.data !== undefined || overdue.data !== undefined
  const refetchAll = () => {
    void goingOut.refetch()
    void dueBack.refetch()
    void overdue.refetch()
  }

  const byKind: AllocationsByKind = useMemo(
    () => ({
      'going-out': goingOut.data ?? [],
      'due-back': dueBack.data ?? [],
      overdue: overdue.data ?? [],
    }),
    [goingOut.data, dueBack.data, overdue.data],
  )

  const allEntries = useMemo(() => buildEntries(byKind, 'all'), [byKind])
  const entries = useMemo(
    () => (filter === 'all' ? allEntries : buildEntries(byKind, filter)),
    [allEntries, byKind, filter],
  )

  // Each chip counts exactly what selecting it would show, "Tudo" included —
  // so its number is the deduplicated union, not the sum of the other three.
  const counts: Record<CalendarFilter, number> = {
    all: allEntries.length,
    'going-out': byKind['going-out'].length,
    'due-back': byKind['due-back'].length,
    overdue: byKind.overdue.length,
  }

  const { data: products } = useProducts()
  const { data: clients } = useClients()

  const productsById = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product])),
    [products],
  )
  const clientNames = useMemo(
    () => new Map((clients ?? []).map((client) => [client.id, client.name])),
    [clients],
  )

  // Built from the full union rather than from the active chip: the panel's
  // job is to say what goes out *and* what comes back on the chosen day,
  // which is the question the shop actually asks, and narrowing the grid to
  // one direction does not narrow that question.
  const daySections: DaySection[] = useMemo(() => {
    if (!selectedDay) return []
    const key = dayKey(selectedDay)
    return KIND_ORDER.map((kind) => ({
      key: kind,
      label: t(FILTER_LABEL_KEY[kind]),
      tone: KIND_TONE[kind],
      entries: allEntries.filter((entry) => entry.kind === kind && dayKey(entry.date) === key),
    }))
  }, [selectedDay, allEntries, t])

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
          {FILTER_ORDER.map((key) => (
            <FilterChip
              key={key}
              active={filter === key}
              onClick={() => setFilter(key)}
              count={counts[key]}
            >
              {t(FILTER_LABEL_KEY[key])}
            </FilterChip>
          ))}
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

      {/*
        Wraps the whole data region from OUTSIDE it. Inside, the failure
        banner became a flex sibling of the list in a ROW container — a
        full-height column beside the table that truncated every name. Out
        here the parent is the screen's own column, so the banner sits above
        the region and the region keeps its own layout.
      */}
      <QueryState isLoading={isLoading} isError={isError} hasData={hasCalendarData} onRetry={refetchAll}>
      <div className="flex min-h-0 flex-1 border-t border-border-strong">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {view === 'agenda' ? (
            <AgendaView entries={entries} products={productsById} clientNames={clientNames} filter={filter} />
          ) : (
            <Suspense fallback={<RouteFallback />}>
              <MonthView
                entries={entries}
                products={productsById}
                date={anchor}
                selectedDay={selectedDay}
                onNavigate={setAnchor}
                onSelectDay={setSelectedDay}
              />
            </Suspense>
          )}
        </div>

        {/*
          Width scales with the viewport instead of a flat 420px on every
          screen — same treatment as Clientes/Contratos' detail panels: this
          panel grows on a wider window rather than staying fixed while the
          calendar grid beside it absorbs all the extra room.
        */}
        <aside className="min-h-0 w-[min(24vw,34rem)] flex-shrink-0 overflow-y-auto border-l border-border-strong">
          <CalendarDayPanel
            day={selectedDay}
            sections={daySections}
            products={productsById}
            clientNames={clientNames}
          />
        </aside>
      </div>
      </QueryState>
    </div>
  )
}
