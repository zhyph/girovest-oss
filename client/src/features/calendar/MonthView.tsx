import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar, dateFnsLocalizer, type DateHeaderProps } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Shirt } from 'lucide-react'
import 'react-big-calendar/lib/css/react-big-calendar.css'
// Must come after the library stylesheet: the overrides win by order at
// equal specificity, and both ride this lazy chunk together.
import './rbc-theme.css'
import { AuthenticatedPhoto } from '../../components/ui/authenticated-photo.tsx'
import { cn } from '../../lib/cn.ts'
import {
  dayKey,
  KIND_COUNT_KEY,
  KIND_ORDER,
  KIND_TONE,
  TONE_TEXT,
  type CalendarEntry,
  type CalendarKind,
} from './calendarEntries.ts'
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

/**
 * How many pieces a cell shows the face of before it stops. Four fits the
 * narrowest column the seven-day grid produces without wrapping; past that
 * the thumbnails stop being recognisable anyway and the remainder is more
 * honestly reported as a number.
 */
const MAX_THUMBS = 4

// Replicated from the Painel's own thumbnail rather than shared: that one is
// a private component inside DashboardPage, and the missing-photo swatch has
// to read identically in both places.
function Thumb({ product }: { product: Product | undefined }) {
  const photo = product?.photos?.[0]
  if (!photo) {
    return (
      <span className="flex size-5 flex-shrink-0 items-center justify-center rounded-badge bg-surface-sunken text-foreground-subtle">
        <Shirt size={11} />
      </span>
    )
  }
  return (
    <AuthenticatedPhoto
      url={photo}
      alt=""
      className="size-5 flex-shrink-0 rounded-badge border border-border object-cover"
    />
  )
}

/**
 * A day cell. It used to stack one coloured pill per piece, each carrying the
 * piece's name, plus react-big-calendar's "+N mais" overflow link — which on a
 * twenty-piece Saturday was a wall of truncated text that answered nothing.
 * The cell now answers the two questions a month grid is actually good for:
 * which pieces (their faces) and how much of what (one count per state). The
 * names live in the day panel, which has the room for them.
 */
function MonthDayCell({
  label,
  drilldownView,
  onDrillDown,
  entries,
  products,
}: DateHeaderProps & { entries: CalendarEntry[]; products: Map<string, Product> }) {
  const { t } = useTranslation('calendarScreen')

  const counts = KIND_ORDER.reduce<Record<CalendarKind, number>>(
    (totals, kind) => {
      totals[kind] = entries.filter((entry) => entry.kind === kind).length
      return totals
    },
    { 'going-out': 0, 'due-back': 0, overdue: 0 },
  )
  const thumbs = entries.slice(0, MAX_THUMBS)
  const hidden = entries.length - thumbs.length

  return (
    <div className="flex flex-col items-start gap-0.5 overflow-hidden">
      {/*
        Keeps react-big-calendar's own class and click handler: the day number
        is still the drill-down affordance, and the rest of the cell still
        selects the day through the grid's slot selection.
      */}
      {drilldownView ? (
        <button type="button" className="rbc-button-link" onClick={onDrillDown}>
          {label}
        </button>
      ) : (
        <span>{label}</span>
      )}

      {entries.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-0.5">
            {thumbs.map((entry) => (
              <Thumb key={entry.key} product={products.get(entry.allocation.productId)} />
            ))}
            {hidden > 0 && (
              <span className="tabular rounded-badge bg-surface-sunken px-1 text-[11px] leading-5 text-foreground-subtle">
                {t('dayCell.more', { hidden })}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
            {KIND_ORDER.filter((kind) => counts[kind] > 0).map((kind) => (
              <span
                key={kind}
                className={cn(
                  'rounded-badge bg-surface-sunken px-1 text-[11px] leading-4 font-medium whitespace-nowrap',
                  TONE_TEXT[KIND_TONE[kind]],
                )}
              >
                {t(KIND_COUNT_KEY[kind], { count: counts[kind] })}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function MonthView({
  entries,
  products,
  onSelectDay,
  date,
  selectedDay,
  onNavigate,
}: {
  entries: CalendarEntry[]
  products: Map<string, Product>
  onSelectDay: (date: Date) => void
  date: Date
  selectedDay: Date | null
  onNavigate: (date: Date) => void
}) {
  const { t } = useTranslation('calendarScreen')

  // Overrides react-big-calendar's built-in English strings. The navigation
  // labels stay mapped even though the library's toolbar is switched off
  // below, because rbc still uses them for the grid's own aria labels.
  const messages = useMemo(
    () => ({
      today: t('rbc.today'),
      previous: t('rbc.previous'),
      next: t('rbc.next'),
      month: t('rbc.month'),
    }),
    [t],
  )

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>()
    for (const entry of entries) {
      const key = dayKey(entry.date)
      const bucket = map.get(key)
      if (bucket) bucket.push(entry)
      else map.set(key, [entry])
    }
    return map
  }, [entries])

  // The cell content is drawn through the date header rather than through
  // rbc events, so the day's pieces are summarised once per cell instead of
  // once per piece. That also takes the library's row-limit and "+N mais"
  // machinery out of the picture entirely: there is nothing left to overflow.
  const components = useMemo(
    () => ({
      month: {
        dateHeader: (props: DateHeaderProps) => (
          <MonthDayCell
            {...props}
            entries={entriesByDay.get(dayKey(props.date)) ?? []}
            products={products}
          />
        ),
      },
    }),
    [entriesByDay, products],
  )

  return (
    // Taller than the bare grid needed: a cell now carries a row of faces and
    // up to three count pills under the day number, and a short row would clip
    // the third one on a busy week.
    <div className="h-full min-h-150">
      <Calendar
        localizer={localizer}
        views={['month']}
        date={date}
        // The library's own Hoje/Anterior/Próximo toolbar is switched off:
        // it was the third control surface competing for the same job, and
        // period navigation now lives once, in the page's control strip.
        toolbar={false}
        onNavigate={onNavigate}
        onSelectSlot={(slot) => onSelectDay(slot.start)}
        onDrillDown={(drillDate) => onSelectDay(drillDate)}
        dayPropGetter={(day) =>
          selectedDay && isSameDay(day, selectedDay) ? { className: 'rbc-day-selected' } : {}
        }
        components={components}
        selectable
        culture="pt-BR"
        messages={messages}
      />
    </div>
  )
}
