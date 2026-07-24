import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { ProductDetailModal } from '../products/ProductDetailModal.tsx'
import { parseDateOnly, formatDate } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

export function CalendarDayItemsList({
  allocations,
  products,
  clientNames,
  dateField,
  pageSize = 20,
}: {
  allocations: Allocation[]
  products: Map<string, Product>
  clientNames: Map<string, string>
  dateField: 'checkoutDate' | 'dueDate'
  pageSize?: number
}) {
  const { t } = useTranslation('calendarScreen')
  const { locale } = useLocale()
  const [page, setPage] = useState(0)
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)

  const totalPages = Math.max(1, Math.ceil(allocations.length / pageSize))
  const currentPage = Math.min(page, Math.max(0, totalPages - 1))
  const pageItems = useMemo(
    () => allocations.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [allocations, currentPage, pageSize],
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2">
        {pageItems.map((allocation) => {
          const product = products.get(allocation.productId)
          const photo = product?.photos?.[0]
          return (
            <button
              key={allocation.id}
              type="button"
              onClick={() => product && setDetailProduct(product)}
              className="flex items-center justify-between gap-2 rounded-md border border-border-soft p-2 text-left text-sm hover:bg-brand-50"
            >
              <div className="flex items-center gap-2">
                {photo && (
                  <img src={photo} alt={product?.name ?? ''} className="h-8 w-8 rounded object-cover" />
                )}
                <div className="flex flex-col">
                  <span>{product?.name ?? allocation.productId}</span>
                  <span className="text-xs text-muted-text">
                    {clientNames.get(allocation.clientId) ?? allocation.clientId}
                  </span>
                </div>
              </div>
              <span className="text-muted-text">
                {formatDate(parseDateOnly(allocation[dateField]), locale, { day: '2-digit', month: '2-digit' })}
              </span>
            </button>
          )
        })}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={currentPage === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            {t('pagination.previous')}
          </Button>
          <span className="text-muted-text">
            {t('pagination.pageOf', { page: currentPage + 1, total: totalPages })}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={currentPage >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('pagination.next')}
          </Button>
        </div>
      )}
      <ProductDetailModal product={detailProduct} open={detailProduct !== null} onClose={() => setDetailProduct(null)} />
    </div>
  )
}
