import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { useClients } from './useClients.ts'
import { ClientDrawer } from './ClientDrawer.tsx'
import type { Client } from './clientSchemas.ts'

export function ClientsPage() {
  const { t } = useTranslation('clients')
  const { data: clients, isLoading } = useClients()
  const [editing, setEditing] = useState<Client | null | undefined>(undefined)

  if (isLoading) return <div>{t('title')}</div>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button onClick={() => setEditing(null)}>{t('common:actions.create', { ns: 'common' })}</Button>
      </div>
      {clients && clients.length === 0 && <p className="text-muted">{t('empty')}</p>}
      <div className="flex flex-col gap-1">
        {clients?.map((client) => (
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
