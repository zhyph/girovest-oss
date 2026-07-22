import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
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
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button onClick={() => setEditing(null)}>{t('common:actions.create', { ns: 'common' })}</Button>
      </div>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('searchPlaceholder')}
        className="mb-3"
        aria-label={t('searchPlaceholder')}
      />
      {clients && clients.length === 0 && <p className="text-muted">{t('empty')}</p>}
      {clients && clients.length > 0 && filteredClients?.length === 0 && (
        <p className="text-muted">{t('noResults')}</p>
      )}
      <div className="flex flex-col gap-1">
        {filteredClients?.map((client) => (
          <button
            key={client.id}
            onClick={() => setEditing(client)}
            className="flex justify-between rounded-md p-2 text-left text-sm hover:bg-brand-50"
          >
            <span>{client.name}</span>
            <span className="text-muted">{client.phone}</span>
          </button>
        ))}
      </div>
      {editing !== undefined && (
        <ClientDrawer key={editing?.id ?? 'new'} client={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}
