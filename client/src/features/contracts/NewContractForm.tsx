import { useState } from 'react'
import { useForm, Controller, useFieldArray, useWatch, type Path } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { CurrencyInput } from '../../components/ui/currency-input.tsx'
import { DateInput } from '../../components/ui/date-input.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { getMissingRequiredFields } from '../../lib/clientReadiness.ts'
import { useClients } from '../clients/useClients.ts'
import { ClientDrawer } from '../clients/ClientDrawer.tsx'
import type { Client } from '../clients/clientSchemas.ts'
import { useProducts } from '../products/useProducts.ts'
import { useProductAvailability } from '../allocations/useAllocations.ts'
import { newContractSchema, type NewContractFormValues } from './contractSchemas.ts'
import { useCreateContract } from './useContracts.ts'

function ItemRow({
  index,
  control,
  register,
  activeProducts,
  onRemove,
  showRemove,
}: {
  index: number
  control: ReturnType<typeof useForm<NewContractFormValues>>['control']
  register: ReturnType<typeof useForm<NewContractFormValues>>['register']
  activeProducts: { id: string; name: string }[]
  onRemove: () => void
  showRemove: boolean
}) {
  const { t } = useTranslation('contracts')
  const productId = useWatchField(control, `items.${index}.productId`)
  const checkoutDate = useWatchField(control, `items.${index}.checkoutDate`)
  const dueDate = useWatchField(control, `items.${index}.dueDate`)
  const availability = useProductAvailability(productId, checkoutDate, dueDate)

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-soft p-2">
      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {t('fields.product')}
          <select
            {...register(`items.${index}.productId`)}
            aria-label={t('fields.product')}
            className="h-10 rounded-md border border-border-soft px-2"
          >
            <option value="">—</option>
            {activeProducts.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </select>
        </label>
        {showRemove && (
          <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={t('items.remove')}>
            <X size={16} />
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {t('fields.checkoutDate')}
          <Controller
            name={`items.${index}.checkoutDate`}
            control={control}
            render={({ field }) => (
              <DateInput value={field.value} onChange={field.onChange} aria-label={t('fields.checkoutDate')} />
            )}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {t('fields.dueDate')}
          <Controller
            name={`items.${index}.dueDate`}
            control={control}
            render={({ field }) => (
              <DateInput value={field.value} onChange={field.onChange} aria-label={t('fields.dueDate')} />
            )}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        {t('fields.priceCharged')}
        <Controller
          name={`items.${index}.priceCharged`}
          control={control}
          render={({ field }) => (
            <CurrencyInput value={field.value} onChange={field.onChange} aria-label={t('fields.priceCharged')} />
          )}
        />
      </label>
      {productId && checkoutDate && dueDate && availability.data?.available === false && (
        <span className="text-xs text-red-600">{t('unavailableProduct')}</span>
      )}
    </div>
  )
}

function useWatchField(
  control: ReturnType<typeof useForm<NewContractFormValues>>['control'],
  name: Path<NewContractFormValues>,
) {
  return useWatch({ control, name }) as string
}

export function NewContractForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('contracts')
  const { locale } = useLocale()
  const { data: clients } = useClients()
  const { data: products } = useProducts()
  const createContract = useCreateContract()
  const [completingClient, setCompletingClient] = useState<Client | null>(null)

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<NewContractFormValues>({
    resolver: zodResolver(newContractSchema),
    defaultValues: {
      locationId: '',
      clientId: '',
      eventDate: '',
      paymentMethod: '',
      items: [{ productId: '', checkoutDate: '', dueDate: '', priceCharged: 0 }],
      installments: [],
    },
  })

  const items = useFieldArray({ control, name: 'items' })
  const selectedClientId = watch('clientId')
  const selectedClient = clients?.find((client) => client.id === selectedClientId) ?? null
  const missingFields = selectedClient ? getMissingRequiredFields(selectedClient, locale) : []

  async function onSubmit(values: NewContractFormValues) {
    try {
      await createContract.mutateAsync(values)
      onClose()
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'UNKNOWN'
      showErrorToast(t(`errors.${code}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) }))
    }
  }

  const activeProducts = products?.filter((product) => product.status === 'active') ?? []

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/40 opacity-100 transition-opacity duration-200 starting:opacity-0" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-y-0 right-0 z-50 w-[36rem] translate-x-0 overflow-y-auto border-l border-border-soft bg-white p-4 shadow-lg transition-transform duration-200 ease-out starting:translate-x-full">
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('fields.client')}
            <select {...register('clientId')} aria-label={t('fields.client')} className="h-10 rounded-md border border-border-soft px-2">
              <option value="">—</option>
              {clients?.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
            {errors.clientId && <span className="text-xs text-red-600">{t('validation.clientRequired')}</span>}
          </label>
          {selectedClient && missingFields.length > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs">
              <span>{t('clientReadiness.missing', { fields: missingFields.join(', ') })}</span>
              <Button type="button" size="sm" variant="secondary" onClick={() => setCompletingClient(selectedClient)}>
                {t('clientReadiness.complete')}
              </Button>
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm">
            {t('fields.eventDate')}
            <Controller
              name="eventDate"
              control={control}
              render={({ field }) => (
                <DateInput value={field.value} onChange={field.onChange} aria-label={t('fields.eventDate')} />
              )}
            />
            {errors.eventDate && <span className="text-xs text-red-600">{t('validation.eventDateRequired')}</span>}
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('items.title')}</span>
            {items.fields.map((field, index) => (
              <ItemRow
                key={field.id}
                index={index}
                control={control}
                register={register}
                activeProducts={activeProducts}
                onRemove={() => items.remove(index)}
                showRemove={items.fields.length > 1}
              />
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() => items.append({ productId: '', checkoutDate: '', dueDate: '', priceCharged: 0 })}
            >
              {t('items.add')}
            </Button>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common:actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" disabled={createContract.isPending}>
              {t('common:actions.save', { ns: 'common' })}
            </Button>
          </div>
        </form>
      </div>
      {completingClient && <ClientDrawer client={completingClient} onClose={() => setCompletingClient(null)} />}
    </>
  )
}
