import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Toolbar, ToolbarSearch, ScreenTitle } from '../../components/ui/toolbar.tsx'
import { DataList, DataListEmpty, type DataListColumn, type DataListGroup } from '../../components/ui/data-list.tsx'
import { RowActions, DropdownMenuItem } from '../../components/ui/dropdown-menu.tsx'
import { useSectionTour } from '../onboarding/useSectionTour.ts'
import { useClients } from './useClients.ts'
import { ClientDrawer } from './ClientDrawer.tsx'
import { ClientDetailPanel } from './ClientDetailPanel.tsx'
import type { Client } from './clientSchemas.ts'

// Groups by the first letter of the name. A few hundred clients are
// unusable as one flat run; the sticky letter heading is what turns
// scrolling to a name into a deliberate act rather than a hunt.
function groupAlphabetically(clients: Client[]): DataListGroup<Client>[] {
  const buckets = new Map<string, Client[]>()
  for (const client of [...clients].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))) {
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
  const { data: clients, isLoading } = useClients()
  const [editing, setEditing] = useState<Client | null | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  useSectionTour('clients', !isLoading)

  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return clients ?? []
    return (clients ?? []).filter(
      (client) =>
        client.name.toLowerCase().includes(query) ||
        client.phone.toLowerCase().includes(query) ||
        client.email.toLowerCase().includes(query),
    )
  }, [clients, search])

  const groups = useMemo(() => groupAlphabetically(filteredClients), [filteredClients])
  const selected = useMemo(
    () => filteredClients.find((client) => client.id === selectedId) ?? null,
    [filteredClients, selectedId],
  )

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
        key: 'email',
        header: t('columns.email'),
        width: '1.2fr',
        cell: (client) => <span className="truncate text-[13px] text-muted-foreground">{client.email}</span>,
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
    [t],
  )

  if (isLoading) return <div>{t('title')}</div>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScreenTitle>{t('title')}</ScreenTitle>
      <Toolbar
        search={
          <ToolbarSearch
            value={search}
            onChange={setSearch}
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
        />

        <aside className="min-h-0 w-130 flex-shrink-0 overflow-y-auto border-l border-border-strong">
          <ClientDetailPanel client={selected} onEdit={(client) => setEditing(client)} />
        </aside>
      </div>

      {editing !== undefined && (
        <ClientDrawer key={editing?.id ?? 'new'} client={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}
