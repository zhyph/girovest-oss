import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Shirt } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { SectionLabel, ScreenTitle } from '../../components/ui/toolbar.tsx'
import { AuthenticatedPhoto } from '../../components/ui/authenticated-photo.tsx'
import CountUp from '../../components/CountUp.tsx'
import { cn } from '../../lib/cn.ts'
import { parseDateOnly, formatDate } from '../../lib/date.ts'
import { formatCurrency, getLocaleConfig } from '../../lib/locale.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { useClients } from '../clients/useClients.ts'
import { useProducts } from '../products/useProducts.ts'
import { useSectionTour } from '../onboarding/useSectionTour.ts'
import { useDashboard, type AllocationSummary } from './useDashboard.ts'
import { BackupReminderBanner } from './BackupReminderBanner.tsx'
import { ChangelogBanner } from './ChangelogBanner.tsx'
import type { Product } from '../products/productSchemas.ts'

function StatTile({
  label,
  value,
  danger,
  display,
  footer,
}: {
  label: string
  value: number
  danger?: boolean
  /**
   * Pre-formatted text to show instead of the animated counter. Money is not
   * a tally — counting up to R$ 4.280,00 digit by digit reads as a slot
   * machine, and CountUp has no currency formatter to hand it anyway.
   */
  display?: string
  /** A third, small line under the number — currently only the receivable tile's "em N contratos em aberto" link. */
  footer?: React.ReactNode
}) {
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
        {display ?? <CountUp to={value} duration={0.6} />}
      </span>
      {footer}
    </div>
  )
}

/**
 * Which way a piece is moving today — NOT what state it is in.
 *
 * Deliberately not a `StatusBadge`. That component owns a single closed
 * vocabulary of real states (Disponível / Reservado / Alugado / Em higienização
 * / Devolvido …) so a word cannot mean two things in two screens, and direction
 * is not one of them. Forcing it in there is what put "Devolvido" beside a
 * dress that is still at the client's house and only due back this afternoon,
 * on the app's own landing screen. A pill outline and an arrow, so it reads as
 * a heading for the row rather than as the piece's status.
 */
function DirectionTag({ kind, label }: { kind: 'out' | 'back'; label: string }) {
  const Arrow = kind === 'out' ? ArrowUpRight : ArrowDownLeft
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border-strong px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground-subtle">
      <Arrow size={12} aria-hidden />
      {label}
    </span>
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
  const {
    goingOutToday,
    dueBackToday,
    overdue,
    upcoming,
    outstanding,
    leavingMaintenance,
    isLoading,
    isError,
    refetch,
  } = useDashboard()
  const currency = getLocaleConfig(locale).currency
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
      <ChangelogBanner />
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
      {/*
        The copy already said "Tente novamente" — with nothing behind it to
        press. A failed Painel is the first thing she sees in the morning, so
        the retry has to be a real control.
      */}
      {isError && (
        <div className="flex-shrink-0 rounded-panel border border-destructive/30 bg-destructive-subtle px-4 py-3.5 text-meta text-destructive-subtle-foreground">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span>{t('error')}</span>
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              {t('common:actions.retry')}
            </Button>
          </div>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {/*
            The tiles stay pinned outside the scroll region. The counts are
            the thing you glance at while reading the movement list beside
            them, so scrolling the list must not carry them off-screen.
          */}
          <div className="mb-4 grid flex-shrink-0 grid-cols-4 gap-3" data-tour="dashboard.stats">
            <StatTile label={t('goingOutToday')} value={goingOutToday.length} />
            <StatTile label={t('dueBackToday')} value={dueBackToday.length} />
            <StatTile label={t('overdue')} value={overdue.length} danger />
            <StatTile
              label={t('receivableTotal')}
              value={outstanding.total}
              display={formatCurrency(outstanding.total, locale, currency)}
              footer={
                outstanding.count > 0 ? (
                  <Link
                    to="/contratos?status=outstanding"
                    className="text-meta text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {t(outstanding.count === 1 ? 'receivableCountOne' : 'receivableCountOther', {
                      count: outstanding.count,
                    })}
                  </Link>
                ) : undefined
              }
            />
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
                        <DirectionTag
                          kind={kind}
                          label={kind === 'out' ? t('goingOutToday') : t('dueBackToday')}
                        />
                      </span>
                    </div>
                  )
                })
              )}
            </Panel>

            <div className="flex flex-col gap-4">
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

            {/*
              The cleaning window is invisible everywhere else: a piece in it
              simply reads "Em higienização" with no hint of when that ends.
              This is the one place the shop can see what it will be able to
              promise a walk-in customer in the next couple of days.
            */}
            <Panel
              label={t('leavingMaintenance')}
              aside={
                leavingMaintenance.count > 0 ? (
                  <span className="tabular text-meta text-muted-foreground">{leavingMaintenance.count}</span>
                ) : undefined
              }
            >
              {leavingMaintenance.items.length === 0 ? (
                <p className="px-4 py-3.5 text-meta text-muted-foreground">{t('leavingMaintenanceEmpty')}</p>
              ) : (
                leavingMaintenance.items.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-[30px_1fr_52px] items-center gap-2.5 border-b border-hairline px-4 py-2 last:border-b-0"
                  >
                    <Thumb product={productsById.get(item.id)} className="size-7.5" />
                    <span className="min-w-0 truncate text-[13px] font-semibold">{item.name}</span>
                    <span className="tabular text-right text-meta text-muted-foreground">
                      {formatDate(parseDateOnly(item.availableOn), locale, {
                        day: '2-digit',
                        month: '2-digit',
                      })}
                    </span>
                  </div>
                ))
              )}
            </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
