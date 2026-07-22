import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { useAuth } from '../../lib/useAuth.ts'
import { productSchema, type Product, type ProductFormValues } from './productSchemas.ts'
import { useCreateProduct, useUpdateProduct, useDeleteProduct } from './useProducts.ts'

export function ProductDrawer({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { t } = useTranslation('products')
  const { staff } = useAuth()
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()
  const deleteProduct = useDeleteProduct()
  const [deleteErrorCode, setDeleteErrorCode] = useState<string | null>(null)
  const [submitErrorCode, setSubmitErrorCode] = useState<string | null>(null)
  const errorCode = deleteErrorCode ?? submitErrorCode
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: product ?? {
      locationId: staff?.locationId ?? '',
      name: '', category: '', size: '', color: '', rentalPrice: 0, depositAmount: 0,
    },
  })

  async function onSubmit(values: ProductFormValues) {
    setSubmitErrorCode(null)
    try {
      if (product) {
        await updateProduct.mutateAsync({ id: product.id, values })
      } else {
        await createProduct.mutateAsync(values)
      }
      onClose()
    } catch (error) {
      setSubmitErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    }
  }

  async function handleDelete() {
    if (!product) return
    setDeleteErrorCode(null)
    try {
      await deleteProduct.mutateAsync(product.id)
      onClose()
    } catch (error) {
      setDeleteErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 w-80 border-l border-border-soft bg-white p-4 shadow-lg">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
        <input type="hidden" {...register('locationId')} />
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.name')}
          <Input {...register('name')} />
          {errors.name && <span className="text-xs text-red-600">{t('validation.nameRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.category')}
          <Input {...register('category')} />
          {errors.category && <span className="text-xs text-red-600">{t('validation.categoryRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.size')}
          <Input {...register('size')} />
          {errors.size && <span className="text-xs text-red-600">{t('validation.sizeRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.color')}
          <Input {...register('color')} />
          {errors.color && <span className="text-xs text-red-600">{t('validation.colorRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.rentalPrice')}
          <Input type="number" step="0.01" {...register('rentalPrice', { valueAsNumber: true })} />
          {errors.rentalPrice && <span className="text-xs text-red-600">{t('validation.rentalPriceInvalid')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.depositAmount')}
          <Input type="number" step="0.01" {...register('depositAmount', { valueAsNumber: true })} />
          {errors.depositAmount && <span className="text-xs text-red-600">{t('validation.depositAmountInvalid')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.description')}
          <Input {...register('description')} />
        </label>
        {errorCode && (
          <p className="text-xs text-red-600">
            {t(`errors.${errorCode}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) })}
          </p>
        )}
        <div className="mt-2 flex justify-between gap-2">
          {product && !product.hasAllocationHistory && (
            <Button type="button" variant="ghost" onClick={handleDelete} disabled={deleteProduct.isPending}>
              {t('common:actions.delete', { ns: 'common' })}
            </Button>
          )}
          <div className="flex flex-1 justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common:actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" disabled={createProduct.isPending || updateProduct.isPending}>
              {t('common:actions.save', { ns: 'common' })}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
