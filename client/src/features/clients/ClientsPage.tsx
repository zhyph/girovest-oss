import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Button } from '../../components/ui/button.tsx'
import { ConfirmDialog } from '../../components/ui/confirm-dialog.tsx'
import { Toolbar, ToolbarSearch, ScreenTitle } from '../../components/ui/toolbar.tsx'
import { DataList, DataListEmpty, type DataListColumn, type DataListGroup } from '../../components/ui/data-list.tsx'
import { RowActions, DropdownMenuItem } from '../../components/ui/dropdown-menu.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { useSectionTour } from '../onboarding/useSectionTour.ts'
import { useProducts } from '../products/useProducts.ts'
import { useClients, useDeleteClient } from './useClients.ts'
import { ClientDrawer } from './ClientDrawer.tsx'
import { ClientDetailPanel } from './ClientDetailPanel.tsx'
import { ProductThumbnail } from './ProductThumbnail.tsx'
import { useAllContracts, useClientRentalSummaries, emptyRentalSummary } from './useClientContracts.ts'
import type { Client } from './clientSchemas.ts'

// Matches Contratos. The alphabetical grouping means a page boundary can fall
// mid-letter, which is why the letter heading is sticky rather than a
// once-per-page title.
const PAGE_SIZE = 20

function sortByName(clients: Client[]): Client[] {
  return [...clients].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

// Groups by the first letter of the name. A few hundred clients are
// unusable as one flat run; the sticky letter heading is what turns
// scrolling to a name into a deliberate act rather than a hunt.
function groupAlphabetically(clients: Client[]): DataListGroup<Client>[] {
  const buckets = new Map<string, Client[]>()
  for (const client of clients) {
    const initial = client.name.trim().charAt(0).toLocaleUpperCase('pt-BR') || '#'
    const bucket = buckets.get(initial)
    if (bucket) bucket.push(client)
    else buckets.set(initial, [client])
  }
  return [...buckets.entries()].map(([letter, rows]) => ({
    key: letter,
    label: letter,
    meta: rows.length,
    rows,
  }))
}

export function ClientsPage() {
  const { t } = useTranslation('clients')
  const navigate = useNavigate()
  const { data: clients, isLoading } = useClients()
  const { data: products } = useProducts()
  const contracts = useAllContracts()
  const summaries = useClientRentalSummaries(contracts)
  const deleteClient = useDeleteClient()
  const [editing, setEditing] = useState<Client | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Client | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  useSectionTour('clients', !isLoading)

  const productsById = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product])),
    [products],
  )

  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase()
    const matching = !query
      ? (clients ?? [])
      : (clients ?? []).filter(
          (client) =>
            client.name.toLowerCase().includes(query) ||
            client.phone.toLowerCase().includes(query) ||
            client.email.toLowerCase().includes(query),
        )
    return sortByName(matching)
  }, [clients, search])

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / PAGE_SIZE))
  // Deleting the last client on the final page, or a refetch returning fewer
  // rows, would otherwise leave the list parked on a page that no longer
  // exists and looking empty.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const pageClients = useMemo(
    () => filteredClients.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredClients, page],
  )
  const groups = useMemo(() => groupAlphabetically(pageClients), [pageClients])
  // Deliberately resolved against the whole filtered set, not the current
  // page: paging away from the client you are reading should not blank the
  // panel beside the list.
  const selected = useMemo(
    () => filteredClients.find((client) => client.id === selectedId) ?? null,
    [filteredClients, selectedId],
  )

  function handleSearchChange(value: string) {
    setSearch(value)
    setPage(1)
  }

  async function handleDelete() {
    if (!deleting) return
    try {
      await deleteClient.mutateAsync(deleting.id)
      if (selectedId === deleting.id) setSelectedId(null)
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'UNKNOWN'
      showErrorToast(t(`errors.${code}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) }))
    } finally {
      setDeleting(null)
    }
  }

  const columns: DataListColumn<Client>[] = useMemo(
    () => [
      {
        key: 'name',
        header: t('fields.name'),
        width: '1.5fr',
        cell: (client) => <span className="truncate text-body font-semibold">{client.name}</span>,
      },
      {
        key: 'phone',
        header: t('fields.phone'),
        width: '140px',
        cell: (client) => <span className="tabular text-[13px] text-muted-foreground">{client.phone}</span>,
      },
      {
        // E-mail was here and was never what the shop scans this list for.
        // Which piece she last took, and how much business she is, are.
        key: 'lastRental',
        header: t('columns.lastRental'),
        width: '1.4fr',
        cell: (client) => {
          const summary = summaries.get(client.id) ?? emptyRentalSummary()
          if (!summary.lastRentalProductId) {
            return <span className="text-[13px] text-foreground-subtle">{t('columns.neverRented')}</span>
          }
          const product = productsById.get(summary.lastRentalProductId)
          return (
            <span className="flex min-w-0 items-center gap-2">
              <ProductThumbnail product={product} className="size-7" />
              <span className="truncate text-[13px] text-muted-foreground">
                {product?.name ?? summary.lastRentalProductId}
              </span>
            </span>
          )
        },
      },
      {
        key: 'contracts',
        header: t('columns.contracts'),
        width: '96px',
        align: 'right',
        cell: (client) => (
          <span className="tabular text-[13px] text-muted-foreground">
            {(summaries.get(client.id) ?? emptyRentalSummary()).contractCount}
          </span>
        ),
      },
      {
        key: 'actions',
        width: '34px',
        cell: (client) => (
          <RowActions label={t('detail.moreActions')}>
            <DropdownMenuItem onSelect={() => setEditing(client)}>
              {t('common:actions.edit', { ns: 'common' })}
            </DropdownMenuItem>
          </RowActions>
        ),
      },
    ],
    [t, summaries, productsById],
  )

  if (isLoading) return <div>{t('title')}</div>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScreenTitle>{t('title')}</ScreenTitle>
      <Toolbar
        search={
          <ToolbarSearch
            value={search}
            onChange={handleSearchChange}
            placeholder={t('searchPlaceholder')}
            label={t('searchPlaceholder')}
            dataTour="clients.search"
          />
        }
        actions={
          <Button onClick={() => setEditing(null)} data-tour="clients.create">
            {t('newButton')}
          </Button>
        }
      />

      {/*
        List and detail side by side. Picking a client fills the panel
        rather than opening a drawer over the list: reading a cadastro is
        the common case and editing it is not, so the old flow charged a
        modal for every look-up. The drawer stays, for editing.
      */}
      <div className="flex min-h-0 flex-1 border-t border-border-strong" data-tour="clients.table">
        <DataList
          columns={columns}
          groups={groups}
          rowKey={(client) => client.id}
          onSelectRow={(client) => setSelectedId(client.id)}
          selectedKey={selectedId}
          empty={
            <DataListEmpty
              title={clients && clients.length === 0 ? t('empty') : t('noResults')}
              action={
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  {t('newButton')}
                </Button>
              }
            />
          }
          pagination={
            totalPages > 1
              ? {
                  label: t('pagination.pageOf', { page, total: totalPages }),
                  onPrevious: () => setPage(page - 1),
                  onNext: () => setPage(page + 1),
                  hasPrevious: page > 1,
                  hasNext: page < totalPages,
                  dataTour: 'clients.pagination',
                }
              : undefined
          }
        />

        <aside className="min-h-0 w-130 flex-shrink-0 overflow-y-auto border-l border-border-strong">
          <ClientDetailPanel
            client={selected}
            contracts={contracts}
            onEdit={(client) => setEditing(client)}
            onDelete={(client) => setDeleting(client)}
            // Carries the client through, so the contract form opens with
            // the person already chosen rather than making staff retype the
            // name they just had selected.
            // The panel hands back the client it is showing, which is also
            // the only one it could be — no need to reach for `selected` and
            // then prove to the compiler that it is not null.
            onNewContract={(client) =>
              navigate(`/contratos?novo=1&clienteId=${encodeURIComponent(client.id)}`)
            }
          />
        </aside>
      </div>

      {editing !== undefined && (
        <ClientDrawer key={editing?.id ?? 'new'} client={editing} onClose={() => setEditing(undefined)} />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t('common:confirmDelete.title', { ns: 'common', name: deleting?.name ?? '' })}
        message={t('common:confirmDelete.message', { ns: 'common' })}
        confirmLabel={t('common:actions.delete', { ns: 'common' })}
        cancelLabel={t('common:actions.cancel', { ns: 'common' })}
        confirmVariant="danger"
        confirmDisabled={deleteClient.isPending}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
