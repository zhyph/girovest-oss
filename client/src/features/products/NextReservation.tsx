import { Calendar } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../../components/ui/badge.tsx'
import { formatDate, parseDateOnly } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import type { UpcomingReservation } from './productSchemas.ts'

const SHORT_DATE: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit' }

/**
 * `derivedAvailability` only looks at today, so a piece booked three weeks
 * out reads exactly like one nobody has touched — "Disponível" either way.
 * These three components all read the same `nextReservation`
 * (server/productService.ts sets it only while `availability` is
 * `'available'`), scaled to how much room each surface has: the catalogue
 * card and list row get a short "since when", the zoom panel — the one place
 * she'd otherwise have to open the piece's history for this — gets the whole
 * booking.
 */
function useReservationLabel(reservation: UpcomingReservation | null | undefined) {
  const { locale } = useLocale()
  if (!reservation) return null
  return formatDate(parseDateOnly(reservation.from), locale, SHORT_DATE)
}

/** Grid card: a full-width hint chip below the piece's own details. */
export function NextReservationHint({
  reservation,
  className,
}: {
  reservation: UpcomingReservation | null | undefined
  className?: string
}) {
  const { t } = useTranslation('products')
  const date = useReservationLabel(reservation)
  if (!date) return null
  return (
    <span
      className={`flex items-center gap-1.5 rounded-control bg-surface-sunken px-2 py-1 text-[11.5px] font-medium text-muted-foreground ${className ?? ''}`}
    >
      <Calendar size={11} className="flex-shrink-0" />
      {t('card.nextReservation', { date })}
    </span>
  )
}

/** List row / zoom "Situação": a short companion pill next to the status badge. */
export function NextReservationTag({ reservation }: { reservation: UpcomingReservation | null | undefined }) {
  const { t } = useTranslation('products')
  const date = useReservationLabel(reservation)
  if (!date) return null
  return (
    <Badge tone="neutral" className="gap-1">
      <Calendar size={11} className="flex-shrink-0" />
      {t('card.nextReservationShort', { date })}
    </Badge>
  )
}

/** Zoom panel: the full booking — period, client, contract — since it's the one place worth the detail. */
export function NextReservationDetail({ reservation }: { reservation: UpcomingReservation | null | undefined }) {
  const { t } = useTranslation('products')
  const { locale } = useLocale()
  if (!reservation) return null
  const from = formatDate(parseDateOnly(reservation.from), locale, SHORT_DATE)
  const to = formatDate(parseDateOnly(reservation.to), locale, SHORT_DATE)
  return (
    <div className="flex gap-2.5 rounded-control border border-border bg-surface-sunken p-2.5">
      <Calendar size={15} className="mt-0.5 flex-shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-0.5">
        <span className="text-[12.5px] font-semibold">{t('zoom.nextReservation')}</span>
        <span className="text-[12.5px] leading-snug text-muted-foreground">
          {t('zoom.nextReservationDetail', {
            from,
            to,
            client: reservation.clientName,
            contract: reservation.contractNumber,
          })}
        </span>
      </div>
    </div>
  )
}
