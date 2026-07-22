import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { CurrencyInput } from '../../components/ui/currency-input.tsx'
import { DateInput } from '../../components/ui/date-input.tsx'
import { useToast } from '../../components/ui/toast.tsx'
import { useClients } from '../clients/useClients.ts'
import { useProducts } from '../products/useProducts.ts'
import { newAllocationSchema, type NewAllocationFormValues } from './allocationSchemas.ts'
import { useCreateAllocation, useProductAvailability } from './useAllocations.ts'

export function NewAllocationForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('allocations')
  const { showToast } = useToast()
  const { data: clients } = useClients()
  const { data: products } = useProducts()
  const createAllocation = useCreateAllocation()

  const { register, handleSubmit, control, watch } = useForm<NewAllocationFormValues>({
    resolver: zodResolver(newAllocationSchema),
    defaultValues: { productId: '', clientId: '', checkoutDate: '', dueDate: '', priceCharged: 0 },
  })

  const selectedProductId = watch('productId')
  const checkoutDate = watch('checkoutDate')
  const dueDate = watch('dueDate')
  const availability = useProductAvailability(selectedProductId, checkoutDate, dueDate)

  async function onSubmit(values: NewAllocationFormValues) {
    try {
      await createAllocation.mutateAsync(values)
      onClose()
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'UNKNOWN'
      showToast(t(`errors.${code}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) }))
    }
  }

  const activeProducts = products?.filter((p) => p.status === 'active') ?? []

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/40 opacity-100 transition-opacity duration-200 starting:opacity-0" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-y-0 right-0 z-50 w-96 translate-x-0 border-l border-border-soft bg-white p-4 shadow-lg transition-transform duration-200 ease-out starting:translate-x-full">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.client')}
          <select {...register('clientId')} className="h-10 rounded-md border border-border-soft px-2">
            <option value="">—</option>
            {clients?.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.checkoutDate')}
          <Controller
            name="checkoutDate"
            control={control}
            render={({ field }) => (
              <DateInput value={field.value} onChange={field.onChange} id="checkoutDate" aria-label={t('fields.checkoutDate')} />
            )}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.dueDate')}
          <Controller
            name="dueDate"
            control={control}
            render={({ field }) => (
              <DateInput value={field.value} onChange={field.onChange} id="dueDate" aria-label={t('fields.dueDate')} />
            )}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.product')}
          <select {...register('productId')} className="h-10 rounded-md border border-border-soft px-2">
            <option value="">—</option>
            {activeProducts.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </select>
          {selectedProductId && checkoutDate && dueDate && availability.data?.available === false && (
            <span className="text-xs text-red-600">{t('unavailableProduct')}</span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.priceCharged')}
          <Controller
            name="priceCharged"
            control={control}
            render={({ field }) => (
              <CurrencyInput value={field.value} onChange={field.onChange} id="priceCharged" aria-label={t('fields.priceCharged')} />
            )}
          />
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common:actions.cancel', { ns: 'common' })}
          </Button>
          <Button
            type="submit"
            disabled={availability.data?.available === false || createAllocation.isPending}
          >
            {t('common:actions.save', { ns: 'common' })}
          </Button>
        </div>
      </form>
      </div>
    </>
  )
}
