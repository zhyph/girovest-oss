import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { parseDateOnly, formatDate } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { useClients } from '../clients/useClients.ts'
import { useProducts } from '../products/useProducts.ts'
import { RowActions } from '../allocations/AllocationsPage.tsx'
import { useContractsList } from './useContracts.ts'
import { NewContractForm } from './NewContractForm.tsx'

export function ContractsPage() {
  const { t } = useTranslation('contracts')
  const { locale } = useLocale()
  const { data: contracts, isLoading } = useContractsList()
  const { data: products } = useProducts()
  const { data: clients } = useClients()
  const [showForm, setShowForm] = useState(false)

  const productNames = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product.name])),
    [products],
  )
  const clientNames = useMemo(
    () => new Map((clients ?? []).map((client) => [client.id, client.name])),
    [clients],
  )

  if (isLoading) return <div>{t('title')}</div>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button onClick={() => setShowForm(true)}>{t('newContract')}</Button>
      </div>
      {contracts && contracts.length === 0 && <p className="text-muted-text">{t('empty')}</p>}
      <div className="flex flex-col gap-3">
        {contracts?.map((contract) => (
          <div key={contract.id} className="rounded-md border border-border-soft p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="font-medium">
                  #{contract.number} — <span>{clientNames.get(contract.clientId) ?? contract.clientId}</span>
                </span>
                <span className="text-xs text-muted-text">
                  {formatDate(parseDateOnly(contract.eventDate), locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {contract.allocations.map((allocation) => (
                <div
                  key={allocation.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border-soft p-2 text-sm"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium">
                      {productNames.get(allocation.productId) ?? allocation.productId}
                    </span>
                    <span className="text-xs text-muted-text">
                      {formatDate(parseDateOnly(allocation.checkoutDate), locale, { day: '2-digit', month: '2-digit', year: 'numeric' })} –{' '}
                      {formatDate(parseDateOnly(allocation.dueDate), locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </span>
                  </div>
                  <div className="shrink-0">
                    <RowActions allocation={allocation} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {showForm && <NewContractForm onClose={() => setShowForm(false)} />}
    </div>
  )
}
