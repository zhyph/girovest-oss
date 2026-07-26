import { useState } from 'react'
import { useForm, Controller, useFieldArray, useWatch, type Path } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { CurrencyInput } from '../../components/ui/currency-input.tsx'
import { DateInput } from '../../components/ui/date-input.tsx'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose, SheetBody } from '../../components/ui/sheet.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { getMissingRequiredFields } from '../../lib/clientReadiness.ts'
import { getPaymentMethods } from '../../lib/paymentMethodTemplate.ts'
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
  checkoutDateError,
  dueDateError,
}: {
  index: number
  control: ReturnType<typeof useForm<NewContractFormValues>>['control']
  register: ReturnType<typeof useForm<NewContractFormValues>>['register']
  activeProducts: { id: string; name: string }[]
  onRemove: () => void
  showRemove: boolean
  checkoutDateError?: string
  dueDateError?: string
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
              <DateInput
                value={field.value}
                onChange={field.onChange}
                aria-label={t('fields.checkoutDate')}
                aria-invalid={checkoutDateError ? true : undefined}
              />
            )}
          />
          {checkoutDateError && <span className="text-xs text-red-600">{checkoutDateError}</span>}
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {t('fields.dueDate')}
          <Controller
            name={`items.${index}.dueDate`}
            control={control}
            render={({ field }) => (
              <DateInput
                value={field.value}
                onChange={field.onChange}
                aria-label={t('fields.dueDate')}
                aria-invalid={dueDateError ? true : undefined}
              />
            )}
          />
          {dueDateError && <span className="text-xs text-red-600">{dueDateError}</span>}
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
      clientId: '',
      eventDate: '',
      paymentMethod: '',
      items: [{ productId: '', checkoutDate: '', dueDate: '', priceCharged: 0 }],
      installments: [],
    },
  })

  const items = useFieldArray({ control, name: 'items' })
  const installments = useFieldArray({ control, name: 'installments' })
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
  const paymentMethods = getPaymentMethods(locale)

  return (
    <>
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-[36rem]" aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{t('newContract')}</SheetTitle>
          <SheetClose aria-label={t('common:actions.close', { ns: 'common' })}>
            <X size={18} />
          </SheetClose>
        </SheetHeader>
        <SheetBody>
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
                <DateInput
                  value={field.value}
                  onChange={field.onChange}
                  aria-label={t('fields.eventDate')}
                  aria-invalid={errors.eventDate ? true : undefined}
                />
              )}
            />
            {errors.eventDate && (
              <span className="text-xs text-red-600">
                {t(errors.eventDate.type === 'custom' ? 'validation.eventDateInvalid' : 'validation.eventDateRequired')}
              </span>
            )}
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
                checkoutDateError={
                  errors.items?.[index]?.checkoutDate
                    ? t(errors.items[index]?.checkoutDate?.type === 'custom' ? 'validation.checkoutDateInvalid' : 'validation.checkoutDateRequired')
                    : undefined
                }
                dueDateError={
                  errors.items?.[index]?.dueDate
                    ? t(errors.items[index]?.dueDate?.type === 'custom' ? 'validation.dueDateInvalid' : 'validation.dueDateRequired')
                    : undefined
                }
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
          <label className="flex flex-col gap-1 text-sm">
            {t('fields.paymentMethod')}
            <select
              {...register('paymentMethod')}
              aria-label={t('fields.paymentMethod')}
              className="h-10 rounded-md border border-border-soft px-2"
            >
              <option value="">—</option>
              {paymentMethods.map((method) => (
                <option key={method} value={method}>{method}</option>
              ))}
            </select>
            {errors.paymentMethod && <span className="text-xs text-red-600">{t('validation.paymentMethodRequired')}</span>}
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('installments.title')}</span>
            {installments.fields.map((field, index) => (
              <div key={field.id} className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  {t('fields.installmentDueDate')}
                  <Controller
                    name={`installments.${index}.dueDate`}
                    control={control}
                    render={({ field: dateField }) => (
                      <DateInput
                        value={dateField.value}
                        onChange={dateField.onChange}
                        aria-label={t('fields.installmentDueDate')}
                        aria-invalid={errors.installments?.[index]?.dueDate ? true : undefined}
                      />
                    )}
                  />
                  {errors.installments?.[index]?.dueDate && (
                    <span className="text-xs text-red-600">
                      {t(
                        errors.installments[index]?.dueDate?.type === 'custom'
                          ? 'validation.installmentDueDateInvalid'
                          : 'validation.installmentDueDateRequired',
                      )}
                    </span>
                  )}
                </label>
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  {t('fields.installmentAmount')}
                  <Controller
                    name={`installments.${index}.amount`}
                    control={control}
                    render={({ field: amountField }) => (
                      <CurrencyInput value={amountField.value} onChange={amountField.onChange} aria-label={t('fields.installmentAmount')} />
                    )}
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => installments.remove(index)}
                  aria-label={t('installments.remove')}
                >
                  <X size={16} />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() => installments.append({ dueDate: '', amount: 0 })}
            >
              {t('installments.add')}
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
        </SheetBody>
      </SheetContent>
    </Sheet>
    {completingClient && <ClientDrawer client={completingClient} onClose={() => setCompletingClient(null)} />}
    </>
  )
}
