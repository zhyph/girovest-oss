import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { CurrencyInput } from '../../components/ui/currency-input.tsx'
import { Modal } from '../../components/ui/modal.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { useAuth } from '../../lib/useAuth.ts'
import { productSchema, type Product, type ProductFormValues, type ProductStatus } from './productSchemas.ts'
import { useCreateProduct, useUpdateProduct, useDeleteProduct } from './useProducts.ts'

const STATUS_OPTIONS: ProductStatus[] = ['active', 'maintenance', 'retired']

export function ProductDrawer({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { t } = useTranslation('products')
  const { staff } = useAuth()
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()
  const deleteProduct = useDeleteProduct()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [status, setStatus] = useState<ProductStatus>(product?.status ?? 'active')
  const [photos, setPhotos] = useState<string[]>(product?.photos ?? [])
  const [newPhotoUrl, setNewPhotoUrl] = useState('')
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: product ?? {
      locationId: staff?.locationId ?? '',
      name: '', category: '', size: '', color: '', rentalPrice: 0, depositAmount: 0,
    },
  })

  function addPhoto() {
    const url = newPhotoUrl.trim()
    if (!url) return
    setPhotos((current) => [...current, url])
    setNewPhotoUrl('')
  }

  function removePhoto(index: number) {
    setPhotos((current) => current.filter((_, i) => i !== index))
  }

  function showError(error: unknown) {
    const code = (error as { code?: string }).code ?? 'UNKNOWN'
    showErrorToast(t(`errors.${code}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) }))
  }

  async function onSubmit(values: ProductFormValues) {
    try {
      if (product) {
        await updateProduct.mutateAsync({ id: product.id, values: { ...values, status, photos } })
      } else {
        await createProduct.mutateAsync({ ...values, photos })
      }
      onClose()
    } catch (error) {
      showError(error)
    }
  }

  async function handleDelete() {
    if (!product) return
    try {
      await deleteProduct.mutateAsync(product.id)
      onClose()
    } catch (error) {
      showError(error)
    } finally {
      setConfirmingDelete(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/40 opacity-100 transition-opacity duration-200 starting:opacity-0" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-y-0 right-0 z-50 w-80 translate-x-0 border-l border-border-soft bg-white p-4 shadow-lg transition-transform duration-200 ease-out starting:translate-x-full">
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
          <Controller
            name="rentalPrice"
            control={control}
            render={({ field }) => (
              <CurrencyInput value={field.value} onChange={field.onChange} id="rentalPrice" aria-label={t('fields.rentalPrice')} />
            )}
          />
          {errors.rentalPrice && <span className="text-xs text-red-600">{t('validation.rentalPriceInvalid')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.depositAmount')}
          <Controller
            name="depositAmount"
            control={control}
            render={({ field }) => (
              <CurrencyInput value={field.value} onChange={field.onChange} id="depositAmount" aria-label={t('fields.depositAmount')} />
            )}
          />
          {errors.depositAmount && <span className="text-xs text-red-600">{t('validation.depositAmountInvalid')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.description')}
          <Input {...register('description')} />
        </label>
        {product && (
          <label className="flex flex-col gap-1 text-sm">
            {t('fields.status')}
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as ProductStatus)}
              className="h-10 rounded-md border border-border-soft px-2 text-sm"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`status.${option}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-col gap-1 text-sm">
          {t('fields.photos')}
          <div className="flex gap-2">
            <Input
              value={newPhotoUrl}
              onChange={(event) => setNewPhotoUrl(event.target.value)}
              placeholder={t('photos.urlPlaceholder')}
            />
            <Button type="button" variant="secondary" onClick={addPhoto}>
              {t('photos.add')}
            </Button>
          </div>
          {photos.length > 0 && (
            <ul className="mt-1 flex flex-col gap-1">
              {photos.map((url, index) => (
                <li key={url + index} className="flex items-center gap-2 text-xs">
                  <img src={url} alt="" className="h-8 w-8 rounded object-cover" />
                  <span className="flex-1 truncate text-muted-text">{url}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removePhoto(index)}>
                    {t('photos.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-2 flex justify-between gap-2">
          {product && !product.hasAllocationHistory && (
            <Button
              type="button"
              variant="danger"
              onClick={() => setConfirmingDelete(true)}
              disabled={deleteProduct.isPending}
            >
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
      {product && (
        <Modal
          open={confirmingDelete}
          onClose={() => setConfirmingDelete(false)}
          title={t('common:confirmDelete.title', { ns: 'common', name: product.name })}
        >
          <p className="mb-4 text-sm text-ink">{t('common:confirmDelete.message', { ns: 'common' })}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmingDelete(false)}>
              {t('common:actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="button" variant="danger" onClick={handleDelete} disabled={deleteProduct.isPending}>
              {t('common:actions.delete', { ns: 'common' })}
            </Button>
          </div>
        </Modal>
      )}
      </div>
    </>
  )
}
