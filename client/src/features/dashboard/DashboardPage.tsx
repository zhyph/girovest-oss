import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardBody } from '../../components/ui/card.tsx'
import CountUp from '../../components/CountUp.tsx'
import { parseDateOnly } from '../../lib/date.ts'
import { useClients } from '../clients/useClients.ts'
import { useProducts } from '../products/useProducts.ts'
import { useDashboard } from './useDashboard.ts'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })

function StatTile({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <Card className={danger && value > 0 ? 'border-red-300 bg-red-50' : undefined}>
      <CardBody>
        <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
        <div className="text-2xl font-semibold">
          <CountUp to={value} duration={0.6} />
        </div>
      </CardBody>
    </Card>
  )
}

export function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const { goingOutToday, dueBackToday, overdue, upcoming, isLoading, isError } = useDashboard()
  const { data: products } = useProducts()
  const { data: clients } = useClients()

  const productNames = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product.name])),
    [products],
  )
  const clientNames = useMemo(
    () => new Map((clients ?? []).map((client) => [client.id, client.name])),
    [clients],
  )

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{t('title')}</h1>
      {isLoading && (
        <Card>
          <CardBody>
            <div className="text-center text-sm text-muted">{t('loading')}</div>
          </CardBody>
        </Card>
      )}
      {isError && (
        <Card className="border-red-300 bg-red-50">
          <CardBody>
            <div className="text-sm text-red-700">{t('error')}</div>
          </CardBody>
        </Card>
      )}
      {!isLoading && !isError && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <StatTile label={t('goingOutToday')} value={goingOutToday.length} />
            <StatTile label={t('dueBackToday')} value={dueBackToday.length} />
            <StatTile label={t('overdue')} value={overdue.length} danger />
          </div>
          <Card className="mt-4">
            <CardBody>
              <div className="mb-2 text-xs uppercase tracking-wide text-muted">{t('upcoming')}</div>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted">{t('upcomingEmpty')}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {upcoming.map((allocation) => (
                    <li key={allocation.id} className="flex justify-between text-sm">
                      <span>
                        {productNames.get(allocation.productId) ?? allocation.productId}
                        {' — '}
                        {clientNames.get(allocation.clientId) ?? allocation.clientId}
                      </span>
                      <span className="text-muted">{dateFormatter.format(parseDateOnly(allocation.checkoutDate))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
