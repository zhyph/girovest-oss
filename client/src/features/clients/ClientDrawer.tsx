import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { clientSchema, type Client, type ClientFormValues } from './clientSchemas.ts'
import { useCreateClient, useUpdateClient, useDeleteClient } from './useClients.ts'

export function ClientDrawer({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const { t } = useTranslation('clients')
  const createClient = useCreateClient()
  const updateClient = useUpdateClient()
  const deleteClient = useDeleteClient()
  const [deleteErrorCode, setDeleteErrorCode] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: client ?? { name: '', phone: '', email: '', notes: '' },
  })

  async function onSubmit(values: ClientFormValues) {
    if (client) {
      await updateClient.mutateAsync({ id: client.id, values })
    } else {
      await createClient.mutateAsync(values)
    }
    onClose()
  }

  async function handleDelete() {
    if (!client) return
    setDeleteErrorCode(null)
    try {
      await deleteClient.mutateAsync(client.id)
      onClose()
    } catch (error) {
      setDeleteErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 w-80 border-l border-border-soft bg-white p-4 shadow-lg">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.name')}
          <Input {...register('name')} />
          {errors.name && <span className="text-xs text-red-600">{t('validation.nameRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.phone')}
          <Input {...register('phone')} />
          {errors.phone && <span className="text-xs text-red-600">{t('validation.phoneRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.email')}
          <Input {...register('email')} />
          {errors.email && <span className="text-xs text-red-600">{t('validation.emailInvalid')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.notes')}
          <Input {...register('notes')} />
        </label>
        {deleteErrorCode && (
          <p className="text-xs text-red-600">
            {t(`errors.${deleteErrorCode}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) })}
          </p>
        )}
        <div className="mt-2 flex justify-between gap-2">
          {client && (
            <Button type="button" variant="ghost" onClick={handleDelete}>
              {t('common:actions.delete', { ns: 'common' })}
            </Button>
          )}
          <div className="flex flex-1 justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit">Salvar</Button>
          </div>
        </div>
      </form>
    </div>
  )
}
