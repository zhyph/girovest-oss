import { useTranslation } from 'react-i18next'
import { parseDateOnly } from '../../lib/date.ts'
import type { Allocation } from '../allocations/allocationSchemas.ts'

export function AgendaView({
  allocations,
  dateField,
  productNames,
}: {
  allocations: Allocation[]
  dateField: 'checkoutDate' | 'dueDate'
  productNames: Map<string, string>
}) {
  const { t } = useTranslation('calendarScreen')
  const formatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })

  if (allocations.length === 0) {
    return <p className="text-muted">{t('empty')}</p>
  }

  const sorted = [...allocations].sort(
    (a, b) => parseDateOnly(a[dateField]).getTime() - parseDateOnly(b[dateField]).getTime(),
  )

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((allocation) => (
        <div key={allocation.id} className="flex justify-between rounded-md border border-border-soft p-2 text-sm">
          <span>{productNames.get(allocation.productId) ?? allocation.productId}</span>
          <span className="text-muted">{formatter.format(parseDateOnly(allocation[dateField]))}</span>
        </div>
      ))}
    </div>
  )
}
