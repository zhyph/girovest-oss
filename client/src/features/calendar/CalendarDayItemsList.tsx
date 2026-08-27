import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { AuthenticatedPhoto } from '../../components/ui/authenticated-photo.tsx'
import { useProductZoom } from '../products/ProductZoomDialog.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDate } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { FILTER_LABEL_KEY, KIND_TONE, TONE_TEXT, type CalendarEntry } from './calendarEntries.ts'
import type { Product } from '../products/productSchemas.ts'

export function CalendarDayItemsList({
  entries,
  products,
  clientNames,
  showKind = false,
  pageSize = 20,
}: {
  entries: CalendarEntry[]
  products: Map<string, Product>
  clientNames: Map<string, string>
  /**
   * Tags each row with what it is. Only worth the ink where a list mixes
   * states — under "Tudo" a row is otherwise indistinguishable from the row
   * above it. The day panel's sections are single-state and say so in their
   * own header, so they leave this off.
   */
  showKind?: boolean
  pageSize?: number
}) {
  const { t } = useTranslation('calendarScreen')
  const { locale } = useLocale()
  // Deliberately NOT reset on every `entries` change: a set that shrinks
  // under a parked page is clamped by `currentPage` below, and stepping back
  // from there is the behaviour its own test pins. What has to reset is a
  // change of DAY or FILTER — a different question entirely — and the callers
  // do that by keying this component, so the state simply starts fresh.
  const [page, setPage] = useState(0)
  const { openZoom, zoomDialog } = useProductZoom()

  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize))
  const currentPage = Math.min(page, Math.max(0, totalPages - 1))
  const pageItems = useMemo(
    () => entries.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [entries, currentPage, pageSize],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {pageItems.map((entry) => {
          const product = products.get(entry.allocation.productId)
          const photo = product?.photos?.[0]
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => product && openZoom(product)}
              className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-left text-sm hover:bg-secondary"
            >
              <div className="flex items-center gap-2">
                {photo && (
                  <AuthenticatedPhoto url={photo} alt={product?.name ?? ''} className="h-8 w-8 rounded object-cover" />
                )}
                <div className="flex flex-col">
                  <span>{product?.name ?? entry.allocation.productId}</span>
                  <span className="text-xs text-muted-foreground">
                    {clientNames.get(entry.allocation.clientId) ?? entry.allocation.clientId}
                  </span>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {showKind && (
                  <span className={cn('text-label uppercase', TONE_TEXT[KIND_TONE[entry.kind]])}>
                    {t(FILTER_LABEL_KEY[entry.kind])}
                  </span>
                )}
                <span className="tabular text-muted-foreground">
                  {formatDate(entry.date, locale, { day: '2-digit', month: '2-digit' })}
                </span>
              </div>
            </button>
          )
        })}
      </div>
      {totalPages > 1 && (
        <div className="flex flex-shrink-0 items-center justify-between text-sm">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {t('pagination.previous')}
          </Button>
          <span className="text-muted-foreground">
            {t('pagination.pageOf', { page: currentPage + 1, total: totalPages })}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={currentPage >= totalPages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            {t('pagination.next')}
          </Button>
        </div>
      )}
      {zoomDialog}
    </div>
  )
}
