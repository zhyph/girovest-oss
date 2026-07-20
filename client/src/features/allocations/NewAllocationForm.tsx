import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { useClients } from '../clients/useClients.ts'
import { useProducts } from '../products/useProducts.ts'
import { newAllocationSchema, type NewAllocationFormValues } from './allocationSchemas.ts'
import { useCreateAllocation, useProductAvailability } from './useAllocations.ts'

export function NewAllocationForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('allocations')
  const { data: clients } = useClients()
  const { data: products } = useProducts()
  const createAllocation = useCreateAllocation()
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const { register, handleSubmit, watch } = useForm<NewAllocationFormValues>({
    resolver: zodResolver(newAllocationSchema),
    defaultValues: { productId: '', clientId: '', checkoutDate: '', dueDate: '', priceCharged: 0 },
  })

  const selectedProductId = watch('productId')
  const checkoutDate = watch('checkoutDate')
  const dueDate = watch('dueDate')
  const availability = useProductAvailability(selectedProductId, checkoutDate, dueDate)

  async function onSubmit(values: NewAllocationFormValues) {
    setErrorCode(null)
    try {
      await createAllocation.mutateAsync(values)
      onClose()
    } catch (error) {
      setErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    }
  }

  const activeProducts = products?.filter((p) => p.status === 'active') ?? []

  return (
    <div className="fixed inset-y-0 right-0 w-96 border-l border-border-soft bg-white p-4 shadow-lg">
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
          <Input type="date" {...register('checkoutDate')} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.dueDate')}
          <Input type="date" {...register('dueDate')} />
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
          <Input type="number" step="0.01" {...register('priceCharged', { valueAsNumber: true })} />
        </label>
        {errorCode && (
          <p className="text-sm text-red-600">
            {t(`errors.${errorCode}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) })}
          </p>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common:actions.cancel', { ns: 'common' })}
          </Button>
          <Button type="submit" disabled={availability.data?.available === false}>
            {t('common:actions.save', { ns: 'common' })}
          </Button>
        </div>
      </form>
    </div>
  )
}
