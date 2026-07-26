import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { AlertTriangle } from 'lucide-react'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Button } from '../../components/ui/button.tsx'
import CountUp from '../../components/CountUp.tsx'
import { parseDateOnly, formatDate } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { useClients } from '../clients/useClients.ts'
import { useProducts } from '../products/useProducts.ts'
import { useDashboard } from './useDashboard.ts'

function StatTile({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  const isUrgent = danger && value > 0
  return (
    <Card className={isUrgent ? 'border-destructive/30 bg-destructive-subtle' : undefined}>
      <CardBody>
        <div className={isUrgent ? 'flex items-center gap-1.5 text-xs font-semibold tracking-wide text-destructive-subtle-foreground uppercase' : 'text-xs uppercase tracking-wide text-muted-foreground'}>
          {isUrgent && <AlertTriangle size={13} />}
          {label}
        </div>
        <div className={isUrgent ? 'text-2xl font-semibold text-destructive-subtle-foreground' : 'text-2xl font-semibold'}>
          <CountUp to={value} duration={0.6} />
        </div>
      </CardBody>
    </Card>
  )
}

export function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const { locale } = useLocale()
  const navigate = useNavigate()
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

  const isBrandNewShop = !isLoading && !isError && clients?.length === 0 && products?.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <h1 className="mb-4 flex-shrink-0 text-xl font-semibold">{t('title')}</h1>
      {isBrandNewShop && (
        <Card className="mb-4 flex-shrink-0 border-primary/30 bg-secondary">
          <CardBody className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-secondary-foreground">{t('gettingStarted.title')}</div>
              <p className="text-sm text-muted-foreground">{t('gettingStarted.description')}</p>
            </div>
            <div className="flex flex-shrink-0 gap-2">
              <Button variant="secondary" size="sm" onClick={() => navigate('/clientes')}>
                {t('gettingStarted.addClient')}
              </Button>
              <Button size="sm" onClick={() => navigate('/produtos')}>
                {t('gettingStarted.addProduct')}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
      {isLoading && (
        <Card className="flex-shrink-0">
          <CardBody>
            <div className="text-center text-sm text-muted-foreground">{t('loading')}</div>
          </CardBody>
        </Card>
      )}
      {isError && (
        <Card className="flex-shrink-0 border-destructive/30 bg-destructive-subtle">
          <CardBody>
            <div className="text-sm text-destructive-subtle-foreground">{t('error')}</div>
          </CardBody>
        </Card>
      )}
      {!isLoading && !isError && (
        <div className="mb-4 grid flex-shrink-0 grid-cols-3 gap-4">
          <StatTile label={t('goingOutToday')} value={goingOutToday.length} />
          <StatTile label={t('dueBackToday')} value={dueBackToday.length} />
          <StatTile label={t('overdue')} value={overdue.length} danger />
        </div>
      )}
      {!isLoading && !isError && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Card>
            <CardBody>
              <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t('upcoming')}</div>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('upcomingEmpty')}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {upcoming.map((allocation) => (
                    <li key={allocation.id} className="flex justify-between text-sm">
                      <span>
                        {productNames.get(allocation.productId) ?? allocation.productId}
                        {' — '}
                        {clientNames.get(allocation.clientId) ?? allocation.clientId}
                      </span>
                      <span className="text-muted-foreground">{formatDate(parseDateOnly(allocation.checkoutDate), locale, { day: '2-digit', month: '2-digit' })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}
