import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { SectionLabel } from '../../components/ui/toolbar.tsx'
import { StatusBadge, type EntityState } from '../../components/ui/status-badge.tsx'
import { RowActions, DropdownMenuItem } from '../../components/ui/dropdown-menu.tsx'
import { AuthenticatedPhoto } from '../../components/ui/authenticated-photo.tsx'
import { formatDate, parseDateOnly } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { formatCurrency, getLocaleConfig } from '../../lib/locale.ts'
import { useProducts } from '../products/useProducts.ts'
import { useProductZoom, PhotoZoomButton } from '../products/ProductZoomDialog.tsx'
import { useClientContractHistory } from './useClientContracts.ts'
import type { Client } from './clientSchemas.ts'

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-foreground-subtle">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </>
  )
}

export function ClientDetailPanel({
  client,
  onEdit,
  onDelete,
  onNewContract,
}: {
  client: Client | null
  onEdit: (client: Client) => void
  onDelete?: (client: Client) => void
  onNewContract?: (client: Client) => void
}) {
  const { t } = useTranslation('clients')
  const { locale } = useLocale()
  const currency = getLocaleConfig(locale).currency
  const { data: products } = useProducts()
  const { openZoom, zoomDialog } = useProductZoom()
  // Fetched per-client, on demand — this panel used to filter the whole
  // location's contract list down to one client's own; now it only ever
  // asks the server for the one client actually on screen.
  const { data: clientContracts, isPending: historyPending } = useClientContractHistory(client?.id ?? null)

  const productsById = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product])),
    [products],
  )

  const history = useMemo(
    () =>
      (clientContracts ?? [])
        .flatMap((contract) =>
          contract.allocations.map((allocation) => ({
            key: allocation.id,
            contractNumber: contract.number,
            product: productsById.get(allocation.productId),
            productId: allocation.productId,
            date: allocation.checkoutDate,
            status: allocation.status as EntityState,
            price: allocation.priceCharged,
          })),
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
    [clientContracts, productsById],
  )

  if (!client) {
    return (
      <div className="p-5">
        <p className="text-meta text-muted-foreground">{t('detail.pickClient')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-heading">{client.name}</span>
          <span className="text-meta text-muted-foreground">
            {/*
              client.contractCount comes from the same request that loaded
              the client itself (see clientSchemas.ts), so there is no
              separate "is the count loaded yet" state to gate on here — by
              the time this panel can render a client at all, its count is
              already known, including a genuine zero.
            */}
            {t('detail.sinceWithContracts', {
              date: formatDate(parseDateOnly(client.createdAt), locale, { month: 'long', year: 'numeric' }),
              count: client.contractCount,
            })}
          </span>
        </div>
        <div className="flex flex-shrink-0 gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => onEdit(client)}>
            {t('common:actions.edit', { ns: 'common' })}
          </Button>
          {onDelete && (
            <RowActions label={t('detail.moreActions')}>
              <DropdownMenuItem destructive onSelect={() => onDelete(client)}>
                {t('common:actions.delete', { ns: 'common' })}
              </DropdownMenuItem>
            </RowActions>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 border-b border-border px-5 py-4">
        <SectionLabel>{t('detail.contactAndDocuments')}</SectionLabel>
        <div className="grid grid-cols-[88px_1fr] gap-x-3.5 gap-y-1.5 text-[13px] leading-relaxed">
          <DetailRow label={t('fields.phone')} value={client.phone} />
          {client.email && <DetailRow label={t('fields.email')} value={client.email} />}
          {/*
            Guarded rather than assumed: these arrive from a paginated list
            cache as well as the detail fetch, and a client rendered from a
            partial cache entry must not take the whole panel down.
          */}
          {(client.identityDocuments ?? []).map((document) => (
            <DetailRow key={document.id} label={document.label} value={document.value} />
          ))}
          {(client.addressLines ?? []).map((line) => (
            <DetailRow key={line.id} label={line.label} value={line.value} />
          ))}
        </div>
      </div>

      {client.notes && (
        <div className="flex flex-col gap-2.5 border-b border-border px-5 py-4">
          <SectionLabel>{t('fields.notes')}</SectionLabel>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{client.notes}</p>
        </div>
      )}

      <div className="flex flex-col gap-2.5 px-5 py-4">
        {/*
          The shortcut sits on this heading rather than the panel header
          because this is where the question "does she need another one?"
          actually gets asked.
        */}
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>{t('detail.rentalHistory')}</SectionLabel>
          {onNewContract && (
            <Button variant="secondary" size="sm" onClick={() => onNewContract(client)}>
              {t('detail.newContract')}
            </Button>
          )}
        </div>
        {history.length === 0 ? (
          // While this client's own history query is still in flight, an
          // empty `history` says nothing about whether she has rentals —
          // render nothing rather than a "never rented" claim the panel
          // cannot yet back up. Once it resolves, an empty result is a real
          // fact (client.contractCount already told the subtitle above this
          // exact thing, from a different, already-loaded request).
          historyPending ? null : <p className="text-meta text-muted-foreground">{t('detail.noHistory')}</p>
        ) : (
          <div className="overflow-hidden rounded-panel border border-border">
            {history.map((entry) => {
              const photo = entry.product?.photos?.[0]
              return (
                <div
                  key={entry.key}
                  className="grid grid-cols-[44px_1fr_92px_92px] items-center gap-2.5 border-b border-hairline bg-card px-3 py-2 last:border-b-0"
                >
                  {/*
                    The photo on the row is the point of this section: it
                    answers "what did she wear last year?" without opening
                    anything.
                  */}
                  {photo ? (
                    <PhotoZoomButton product={entry.product} onZoom={openZoom}>
                      <AuthenticatedPhoto
                        url={photo}
                        alt={entry.product?.name ?? ''}
                        className="size-11 rounded-badge border border-border object-cover"
                      />
                    </PhotoZoomButton>
                  ) : (
                    <span className="size-11 rounded-badge border border-border bg-surface-sunken" />
                  )}
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[13px] font-semibold">
                      {entry.product?.name ?? entry.productId}
                    </span>
                    <span className="font-mono text-[11px] text-foreground-subtle">
                      {entry.contractNumber} ·{' '}
                      {formatDate(parseDateOnly(entry.date), locale, {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                    </span>
                  </span>
                  <span>
                    <StatusBadge state={entry.status} />
                  </span>
                  <span className="tabular text-right text-[13px]">
                    {formatCurrency(entry.price, locale, currency)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {zoomDialog}
    </div>
  )
}
