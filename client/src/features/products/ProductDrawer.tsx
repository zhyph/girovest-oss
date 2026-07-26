import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { CurrencyInput } from '../../components/ui/currency-input.tsx'
import { Modal } from '../../components/ui/modal.tsx'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from '../../components/ui/sheet.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { useAuth } from '../../lib/useAuth.ts'
import { AuthenticatedPhoto } from '../../components/ui/authenticated-photo.tsx'
import { productSchema, type Product, type ProductFormValues, type ProductStatus } from './productSchemas.ts'
import { useCreateProduct, useUpdateProduct, useDeleteProduct } from './useProducts.ts'

const STATUS_OPTIONS: ProductStatus[] = ['active', 'maintenance', 'retired']

function PhotoThumbnail({ url }: { url: string }) {
  return <AuthenticatedPhoto url={url} alt="" className="h-16 w-16 rounded object-cover" />
}

export function ProductDrawer({
  product,
  onClose,
  duplicateDefaults,
  onCreated,
}: {
  product: Product | null
  onClose: () => void
  duplicateDefaults?: Partial<ProductFormValues>
  onCreated?: (values: ProductFormValues) => void
}) {
  const { t } = useTranslation('products')
  const { staff } = useAuth()
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()
  const deleteProduct = useDeleteProduct()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [status, setStatus] = useState<ProductStatus>(product?.status ?? 'active')
  const [photos, setPhotos] = useState<string[]>(product?.photos ?? [])
  const [newPhotoUrl, setNewPhotoUrl] = useState('')
  const [addAnotherAfterSave, setAddAnotherAfterSave] = useState(false)
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: product ?? {
      locationId: staff?.locationId ?? '',
      name: '',
      category: duplicateDefaults?.category ?? '',
      size: duplicateDefaults?.size ?? '',
      color: duplicateDefaults?.color ?? '',
      rentalPrice: duplicateDefaults?.rentalPrice ?? 0,
      depositAmount: duplicateDefaults?.depositAmount ?? 0,
      description: duplicateDefaults?.description,
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
        onClose()
      } else {
        await createProduct.mutateAsync({ ...values, photos })
        onCreated?.(values)
        if (addAnotherAfterSave) {
          setPhotos([])
          reset({
            locationId: staff?.locationId ?? '',
            name: '',
            category: values.category,
            size: values.size,
            color: values.color,
            rentalPrice: values.rentalPrice,
            depositAmount: values.depositAmount,
            description: values.description,
          })
        } else {
          onClose()
        }
      }
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

  const drawerTitle = product ? t('editTitle') : t('newTitle')

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-80" aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{drawerTitle}</SheetTitle>
          <SheetClose aria-label={t('common:actions.close', { ns: 'common' })}>
            <X size={18} />
          </SheetClose>
        </SheetHeader>
      <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col p-4">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <input type="hidden" {...register('locationId')} />
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.name')}
          <Input {...register('name')} aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? 'product-name-error' : undefined} />
          {errors.name && <span id="product-name-error" className="text-xs text-red-600">{t('validation.nameRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.category')}
          <Input {...register('category')} aria-invalid={errors.category ? true : undefined} aria-describedby={errors.category ? 'product-category-error' : undefined} />
          {errors.category && <span id="product-category-error" className="text-xs text-red-600">{t('validation.categoryRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.size')}
          <Input {...register('size')} aria-invalid={errors.size ? true : undefined} aria-describedby={errors.size ? 'product-size-error' : undefined} />
          {errors.size && <span id="product-size-error" className="text-xs text-red-600">{t('validation.sizeRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.color')}
          <Input {...register('color')} aria-invalid={errors.color ? true : undefined} aria-describedby={errors.color ? 'product-color-error' : undefined} />
          {errors.color && <span id="product-color-error" className="text-xs text-red-600">{t('validation.colorRequired')}</span>}
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
                  <PhotoThumbnail url={url} />
                  <span className="flex-1 truncate text-muted-text">{url}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removePhoto(index)}>
                    {t('photos.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {!product && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={addAnotherAfterSave}
              onChange={(event) => setAddAnotherAfterSave(event.target.checked)}
            />
            {t('common:actions.saveAndAddAnother', { ns: 'common' })}
          </label>
        )}
        </div>
        <div className="mt-2 flex flex-shrink-0 justify-between gap-2">
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
          <div className="flex flex-1 flex-shrink-0 justify-end gap-2">
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
      </SheetContent>
    </Sheet>
  )
}
