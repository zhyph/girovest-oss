import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { cn } from '../../lib/cn.ts'
import { useClients } from './useClients.ts'
import { ClientDrawer } from './ClientDrawer.tsx'
import type { Client } from './clientSchemas.ts'

export function ClientsPage() {
  const { t } = useTranslation('clients')
  const { data: clients, isLoading } = useClients()
  const [editing, setEditing] = useState<Client | null | undefined>(undefined)
  const [search, setSearch] = useState('')

  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return clients
    return clients?.filter(
      (client) =>
        client.name.toLowerCase().includes(query) ||
        client.phone.toLowerCase().includes(query) ||
        client.email.toLowerCase().includes(query),
    )
  }, [clients, search])

  if (isLoading) return <div>{t('title')}</div>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex flex-shrink-0 items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button onClick={() => setEditing(null)}>{t('common:actions.create', { ns: 'common' })}</Button>
      </div>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('searchPlaceholder')}
        className="mb-3 flex-shrink-0"
        aria-label={t('searchPlaceholder')}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {clients && clients.length === 0 && <p className="text-muted-text">{t('empty')}</p>}
        {clients && clients.length > 0 && filteredClients?.length === 0 && (
          <p className="text-muted-text">{t('noResults')}</p>
        )}
        {filteredClients && filteredClients.length > 0 && (
          <div className="overflow-hidden rounded-md border border-border-soft">
            <div className="flex justify-between bg-gray-50 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-text">
              <span>{t('fields.name')}</span>
              <span>{t('fields.phone')}</span>
            </div>
            <div className="flex flex-col">
              {filteredClients.map((client, index) => (
                <button
                  key={client.id}
                  onClick={() => setEditing(client)}
                  className={cn(
                    'flex justify-between p-2 text-left text-sm hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-cream',
                    index % 2 === 1 && 'bg-gray-50/50',
                  )}
                >
                  <span>{client.name}</span>
                  <span className="text-muted-text">{client.phone}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {editing !== undefined && (
        <ClientDrawer key={editing?.id ?? 'new'} client={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}
