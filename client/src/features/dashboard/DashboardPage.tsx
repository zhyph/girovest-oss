import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { AlertTriangle, Shirt } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { SectionLabel, ScreenTitle } from '../../components/ui/toolbar.tsx'
import { StatusBadge } from '../../components/ui/status-badge.tsx'
import { AuthenticatedPhoto } from '../../components/ui/authenticated-photo.tsx'
import CountUp from '../../components/CountUp.tsx'
import { cn } from '../../lib/cn.ts'
import { parseDateOnly, formatDate } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { useClients } from '../clients/useClients.ts'
import { useProducts } from '../products/useProducts.ts'
import { useSectionTour } from '../onboarding/useSectionTour.ts'
import { useDashboard, type AllocationSummary } from './useDashboard.ts'
import { BackupReminderBanner } from './BackupReminderBanner.tsx'
import type { Product } from '../products/productSchemas.ts'

function StatTile({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  const isUrgent = danger && value > 0
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-panel border px-4 py-3.5',
        isUrgent ? 'border-destructive/30 bg-destructive-subtle' : 'border-border bg-card',
      )}
    >
      <span
        className={cn(
          'flex items-center gap-1.5 text-label uppercase',
          isUrgent ? 'text-destructive-subtle-foreground' : 'text-foreground-subtle',
        )}
      >
        {isUrgent && <AlertTriangle size={13} />}
        {label}
      </span>
      {/* The one `metric` step on this screen: the number is the headline. */}
      <span
        className={cn(
          'tabular text-metric',
          isUrgent ? 'text-destructive-subtle-foreground' : 'text-foreground',
        )}
      >
        <CountUp to={value} duration={0.6} />
      </span>
    </div>
  )
}

function Thumb({ product, className }: { product: Product | undefined; className?: string }) {
  const photo = product?.photos?.[0]
  if (!photo) {
    return (
      <span
        className={cn(
          'flex flex-shrink-0 items-center justify-center rounded-badge border border-border bg-surface-sunken text-foreground-subtle',
          className,
        )}
      >
        <Shirt size={14} />
      </span>
    )
  }
  return (
    <AuthenticatedPhoto
      url={photo}
      alt=""
      className={cn('flex-shrink-0 rounded-badge border border-border object-cover', className)}
    />
  )
}

function Panel({
  label,
  aside,
  children,
  tour,
}: {
  label: string
  aside?: React.ReactNode
  children: React.ReactNode
  tour?: string
}) {
  return (
    <div className="overflow-hidden rounded-panel border border-border-strong bg-surface" data-tour={tour}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <SectionLabel>{label}</SectionLabel>
        {aside}
      </div>
      {children}
    </div>
  )
}

export function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const { locale } = useLocale()
  const navigate = useNavigate()
  const { goingOutToday, dueBackToday, overdue, upcoming, isLoading, isError } = useDashboard()
  const { data: products } = useProducts()
  const { data: clients } = useClients()
  useSectionTour('dashboard', !isLoading && !isError)

  const productsById = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product])),
    [products],
  )
  const clientNames = useMemo(
    () => new Map((clients ?? []).map((client) => [client.id, client.name])),
    [clients],
  )

  // The tiles say how many; this says which. Today's two directions are
  // one list, tagged, because the counter alone never answered the
  // question the shop actually has in the morning.
  const todayMovement = useMemo(
    () => [
      ...goingOutToday.map((allocation) => ({ allocation, kind: 'out' as const })),
      ...dueBackToday.map((allocation) => ({ allocation, kind: 'back' as const })),
    ],
    [goingOutToday, dueBackToday],
  )

  const isBrandNewShop = !isLoading && !isError && clients?.length === 0 && products?.length === 0

  function describe(allocation: AllocationSummary) {
    return {
      product: productsById.get(allocation.productId),
      productName: productsById.get(allocation.productId)?.name ?? allocation.productId,
      clientName: clientNames.get(allocation.clientId) ?? allocation.clientId,
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BackupReminderBanner />
      <div className="flex flex-shrink-0 items-baseline justify-between gap-5">
        <ScreenTitle data-tour="dashboard.title">{t('title')}</ScreenTitle>
        <span className="text-[13px] text-muted-foreground">
          {formatDate(new Date(), locale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
        </span>
      </div>

      {isBrandNewShop && (
        <div
          className="mb-4 flex flex-shrink-0 items-center justify-between gap-3 rounded-panel border border-primary/30 bg-secondary px-4 py-3.5"
          data-tour="dashboard.gettingStarted"
        >
          <div>
            <div className="text-body font-semibold text-secondary-foreground">{t('gettingStarted.title')}</div>
            <p className="text-meta text-muted-foreground">{t('gettingStarted.description')}</p>
          </div>
          <div className="flex flex-shrink-0 gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate('/clientes')}>
              {t('gettingStarted.addClient')}
            </Button>
            <Button size="sm" onClick={() => navigate('/produtos')}>
              {t('gettingStarted.addProduct')}
            </Button>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex-shrink-0 rounded-panel border border-border bg-card px-4 py-3.5 text-center text-meta text-muted-foreground">
          {t('loading')}
        </div>
      )}
      {isError && (
        <div className="flex-shrink-0 rounded-panel border border-destructive/30 bg-destructive-subtle px-4 py-3.5 text-meta text-destructive-subtle-foreground">
          {t('error')}
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {/*
            The tiles stay pinned outside the scroll region. The counts are
            the thing you glance at while reading the movement list beside
            them, so scrolling the list must not carry them off-screen.
          */}
          <div className="mb-4 grid flex-shrink-0 grid-cols-3 gap-3" data-tour="dashboard.stats">
            <StatTile label={t('goingOutToday')} value={goingOutToday.length} />
            <StatTile label={t('dueBackToday')} value={dueBackToday.length} />
            <StatTile label={t('overdue')} value={overdue.length} danger />
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[1.5fr_1fr] items-start gap-4 overflow-y-auto">
            <Panel label={t('todayMovement')}>
              {todayMovement.length === 0 ? (
                <p className="px-4 py-3.5 text-meta text-muted-foreground">{t('todayMovementEmpty')}</p>
              ) : (
                todayMovement.map(({ allocation, kind }) => {
                  const { product, productName, clientName } = describe(allocation)
                  return (
                    <div
                      key={`${kind}-${allocation.id}`}
                      className="grid grid-cols-[44px_1fr_118px] items-center gap-3 border-b border-hairline px-4 py-2 last:border-b-0"
                    >
                      <Thumb product={product} className="size-11" />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-[13.5px] font-semibold">{productName}</span>
                        <span className="truncate text-xs text-muted-foreground">{clientName}</span>
                      </span>
                      <span>
                        <StatusBadge state={kind === 'out' ? 'checked_out' : 'returned'} />
                      </span>
                    </div>
                  )
                })
              )}
            </Panel>

            <Panel label={t('upcoming')} tour="dashboard.upcoming">
              {upcoming.length === 0 ? (
                <p className="px-4 py-3.5 text-meta text-muted-foreground">{t('upcomingEmpty')}</p>
              ) : (
                upcoming.map((allocation) => {
                  const { product, productName, clientName } = describe(allocation)
                  return (
                    <div
                      key={allocation.id}
                      className="grid grid-cols-[30px_1fr_52px] items-center gap-2.5 border-b border-hairline px-4 py-2 last:border-b-0"
                    >
                      <Thumb product={product} className="size-7.5" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] font-semibold">{productName}</span>
                        <span className="truncate text-[11.5px] text-muted-foreground">{clientName}</span>
                      </span>
                      <span className="tabular text-right text-meta text-muted-foreground">
                        {formatDate(parseDateOnly(allocation.checkoutDate), locale, {
                          day: '2-digit',
                          month: '2-digit',
                        })}
                      </span>
                    </div>
                  )
                })
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
