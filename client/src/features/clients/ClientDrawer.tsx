import { useState } from 'react'
import { useForm, Controller, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { PhoneInput } from '../../components/ui/phone-input.tsx'
import { MaskedTextInput } from '../../components/ui/masked-text-input.tsx'
import { Modal } from '../../components/ui/modal.tsx'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose, SheetBody } from '../../components/ui/sheet.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { getClientFieldTemplate } from '../../lib/clientFieldTemplates.ts'
import { getFieldMask } from '../../lib/clientFieldMasks.ts'
import { clientSchema, type Client, type ClientFormValues } from './clientSchemas.ts'
import { useCreateClient, useUpdateClient, useDeleteClient } from './useClients.ts'

export function ClientDrawer({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const { t } = useTranslation('clients')
  const { locale } = useLocale()
  const createClient = useCreateClient()
  const updateClient = useUpdateClient()
  const deleteClient = useDeleteClient()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const template = getClientFieldTemplate(locale)
  const defaultIdentityDocuments = client
    ? client.identityDocuments
    : template.identityDocuments.map((entry) => ({ label: entry.label, value: '', maskKey: entry.maskKey ?? null }))
  const defaultAddressLines = client
    ? client.addressLines
    : template.addressLines.map((entry, index) => ({
        label: entry.label,
        value: '',
        sortOrder: index,
        maskKey: entry.maskKey ?? null,
      }))

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: client ?? {
      name: '',
      phone: '',
      email: '',
      notes: '',
      identityDocuments: defaultIdentityDocuments,
      addressLines: defaultAddressLines,
    },
  })

  const identityDocuments = useFieldArray({ control, name: 'identityDocuments' })
  const addressLines = useFieldArray({ control, name: 'addressLines' })

  function showError(error: unknown) {
    const code = (error as { code?: string }).code ?? 'UNKNOWN'
    showErrorToast(t(`errors.${code}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) }))
  }

  async function onSubmit(values: ClientFormValues) {
    const normalized: ClientFormValues = {
      ...values,
      identityDocuments: values.identityDocuments.filter((doc) => doc.value.trim() !== ''),
      addressLines: values.addressLines
        .filter((line) => line.value.trim() !== '')
        .map((line, index) => ({ ...line, sortOrder: index })),
    }
    try {
      if (client) {
        await updateClient.mutateAsync({ id: client.id, values: normalized })
      } else {
        await createClient.mutateAsync(normalized)
      }
      onClose()
    } catch (error) {
      showError(error)
    }
  }

  async function handleDelete() {
    if (!client) return
    try {
      await deleteClient.mutateAsync(client.id)
      onClose()
    } catch (error) {
      showError(error)
    } finally {
      setConfirmingDelete(false)
    }
  }

  const drawerTitle = client ? t('editTitle') : t('newTitle')

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-96" aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{drawerTitle}</SheetTitle>
          <SheetClose aria-label={t('common:actions.close', { ns: 'common' })}>
            <X size={18} />
          </SheetClose>
        </SheetHeader>
        <SheetBody>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.name')}
          <Input {...register('name')} aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? 'client-name-error' : undefined} />
          {errors.name && <span id="client-name-error" className="text-xs text-red-600">{t('validation.nameRequired')}</span>}
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
          <Input
            type="email"
            inputMode="email"
            {...register('email')}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'client-email-error' : undefined}
          />
          {errors.email && <span id="client-email-error" className="text-xs text-red-600">{t('validation.emailInvalid')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.notes')}
          <Input {...register('notes')} />
        </label>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('identityDocuments.title')}</span>
          {identityDocuments.fields.map((field, index) => {
            const isDefaultField = template.identityDocuments[index]?.label === field.label
            return (
            <div key={field.id} className="flex items-end gap-2">
              <label className="flex w-24 shrink-0 flex-col gap-1 text-sm">
                {t('identityDocuments.label')}
                <Input
                  {...register(`identityDocuments.${index}.label`)}
                  aria-label={t('identityDocuments.labelFieldAria')}
                  readOnly={isDefaultField}
                  className={isDefaultField ? 'cursor-default bg-gray-50 text-muted-text' : undefined}
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                {t('identityDocuments.value')}
                <Controller
                  name={`identityDocuments.${index}.value`}
                  control={control}
                  render={({ field: valueField }) => (
                    <MaskedTextInput
                      value={valueField.value}
                      onChange={valueField.onChange}
                      mask={getFieldMask(identityDocuments.fields[index].maskKey)}
                      aria-label={t('identityDocuments.valueFieldAria')}
                    />
                  )}
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => identityDocuments.remove(index)}
                aria-label={t('identityDocuments.remove')}
              >
                <X size={16} />
              </Button>
            </div>
          )})}
          <Button
            type="button"
            variant="secondary"
            onClick={() => identityDocuments.append({ label: '', value: '', maskKey: null })}
          >
            {t('identityDocuments.add')}
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('addressLines.title')}</span>
          {addressLines.fields.map((field, index) => {
            const isDefaultField = template.addressLines[index]?.label === field.label
            return (
            <div key={field.id} className="flex items-end gap-2">
              <label className="flex w-24 shrink-0 flex-col gap-1 text-sm">
                {t('addressLines.label')}
                <Input
                  {...register(`addressLines.${index}.label`)}
                  aria-label={t('addressLines.labelFieldAria')}
                  readOnly={isDefaultField}
                  className={isDefaultField ? 'cursor-default bg-gray-50 text-muted-text' : undefined}
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                {t('addressLines.value')}
                <Controller
                  name={`addressLines.${index}.value`}
                  control={control}
                  render={({ field: valueField }) => (
                    <MaskedTextInput
                      value={valueField.value}
                      onChange={valueField.onChange}
                      mask={getFieldMask(addressLines.fields[index].maskKey)}
                      aria-label={t('addressLines.valueFieldAria')}
                    />
                  )}
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => addressLines.remove(index)}
                aria-label={t('addressLines.remove')}
              >
                <X size={16} />
              </Button>
            </div>
          )})}
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              addressLines.append({ label: '', value: '', sortOrder: addressLines.fields.length, maskKey: null })
            }
          >
            {t('addressLines.add')}
          </Button>
        </div>
        <div className="mt-2 flex justify-between gap-2">
          {client && !client.hasAllocationHistory && (
            <Button
              type="button"
              variant="danger"
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
            <Button type="button" variant="danger" onClick={handleDelete} disabled={deleteClient.isPending}>
              {t('common:actions.delete', { ns: 'common' })}
            </Button>
          </div>
        </Modal>
      )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
