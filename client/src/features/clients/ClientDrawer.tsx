import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { PhoneInput } from '../../components/ui/phone-input.tsx'
import { Modal } from '../../components/ui/modal.tsx'
import { clientSchema, type Client, type ClientFormValues } from './clientSchemas.ts'
import { useCreateClient, useUpdateClient, useDeleteClient } from './useClients.ts'

export function ClientDrawer({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const { t } = useTranslation('clients')
  const createClient = useCreateClient()
  const updateClient = useUpdateClient()
  const deleteClient = useDeleteClient()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteErrorCode, setDeleteErrorCode] = useState<string | null>(null)
  const [submitErrorCode, setSubmitErrorCode] = useState<string | null>(null)
  const errorCode = deleteErrorCode ?? submitErrorCode
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: client ?? { name: '', phone: '', email: '', notes: '' },
  })

  async function onSubmit(values: ClientFormValues) {
    setSubmitErrorCode(null)
    try {
      if (client) {
        await updateClient.mutateAsync({ id: client.id, values })
      } else {
        await createClient.mutateAsync(values)
      }
      onClose()
    } catch (error) {
      setSubmitErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    }
  }

  async function handleDelete() {
    if (!client) return
    setDeleteErrorCode(null)
    try {
      await deleteClient.mutateAsync(client.id)
      onClose()
    } catch (error) {
      setDeleteErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    } finally {
      setConfirmingDelete(false)
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
          <Controller
            name="phone"
            control={control}
            render={({ field }) => (
              <PhoneInput value={field.value} onChange={field.onChange} id="phone" aria-label={t('fields.phone')} />
            )}
          />
          {errors.phone && <span className="text-xs text-red-600">{t('validation.phoneRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.email')}
          <Input type="email" inputMode="email" {...register('email')} />
          {errors.email && <span className="text-xs text-red-600">{t('validation.emailInvalid')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.notes')}
          <Input {...register('notes')} />
        </label>
        {errorCode && (
          <p className="text-xs text-red-600">
            {t(`errors.${errorCode}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) })}
          </p>
        )}
        <div className="mt-2 flex justify-between gap-2">
          {client && !client.hasAllocationHistory && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmingDelete(true)}
              disabled={deleteClient.isPending}
            >
              {t('common:actions.delete', { ns: 'common' })}
            </Button>
          )}
          <div className="flex flex-1 justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common:actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" disabled={createClient.isPending || updateClient.isPending}>
              {t('common:actions.save', { ns: 'common' })}
            </Button>
          </div>
        </div>
      </form>
      {client && (
        <Modal
          open={confirmingDelete}
          onClose={() => setConfirmingDelete(false)}
          title={t('common:confirmDelete.title', { ns: 'common', name: client.name })}
        >
          <p className="mb-4 text-sm text-ink">{t('common:confirmDelete.message', { ns: 'common' })}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmingDelete(false)}>
              {t('common:actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="button" onClick={handleDelete} disabled={deleteClient.isPending}>
              {t('common:actions.delete', { ns: 'common' })}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
