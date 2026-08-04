import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { CurrencyInput } from '../../components/ui/currency-input.tsx'
import { ConfirmDialog } from '../../components/ui/confirm-dialog.tsx'
import { Select } from '../../components/ui/select.tsx'
import { AutocompleteInput } from '../../components/ui/autocomplete-input.tsx'
import { RequiredMark } from '../../components/ui/required-mark.tsx'
import { normalizeToSuggestion } from '../../lib/autocompleteMatch.ts'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose, SheetBody } from '../../components/ui/sheet.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { useAuth } from '../../lib/useAuth.ts'
import { useUnsavedChangesGuard } from '../../lib/useUnsavedChangesGuard.ts'
import { AuthenticatedPhoto } from '../../components/ui/authenticated-photo.tsx'
import { productSchema, type Product, type ProductFormValues, type ProductStatus } from './productSchemas.ts'
import { useCreateProduct, useUpdateProduct, useDeleteProduct, useProducts } from './useProducts.ts'

const STATUS_OPTIONS: ProductStatus[] = ['active', 'maintenance', 'retired']

function PhotoThumbnail({ url }: { url: string }) {
  return <AuthenticatedPhoto url={url} alt="" className="h-16 w-16 rounded object-cover" />
}

export function ProductDrawer({
  product,
  onClose,
  duplicateDefaults,
  initialName,
  allowSaveAndAddAnother = true,
  onCreated,
}: {
  product: Product | null
  onClose: () => void
  duplicateDefaults?: Partial<ProductFormValues>
  initialName?: string
  allowSaveAndAddAnother?: boolean
  onCreated?: (product: Product) => void
}) {
  const { t } = useTranslation('products')
  const { staff } = useAuth()
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()
  const deleteProduct = useDeleteProduct()
  const { data: allProducts } = useProducts()
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
    formState: { errors, isDirty },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: product ?? {
      locationId: staff?.locationId ?? '',
      name: initialName ?? '',
      category: duplicateDefaults?.category ?? '',
      size: duplicateDefaults?.size ?? '',
      color: duplicateDefaults?.color ?? '',
      rentalPrice: duplicateDefaults?.rentalPrice ?? 0,
      depositAmount: duplicateDefaults?.depositAmount ?? 0,
      description: duplicateDefaults?.description,
    },
  })

  // status, photos and newPhotoUrl live outside react-hook-form, so isDirty
  // alone under-reports: without this the user could still lose an added photo.
  const initialPhotos = product?.photos ?? []
  const hasUnsavedChanges =
    isDirty ||
    status !== (product?.status ?? 'active') ||
    photos.length !== initialPhotos.length ||
    photos.some((url, index) => url !== initialPhotos[index]) ||
    newPhotoUrl.trim() !== ''
  const discardGuard = useUnsavedChangesGuard({ isDirty: hasUnsavedChanges, onConfirmDiscard: onClose })

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
    // Snap category/size/color to whatever casing/accents are already on
    // file for the same value, so "gala" and "Gala" don't quietly become
    // two different catalogue entries depending on who typed it.
    const normalized: ProductFormValues = {
      ...values,
      category: normalizeToSuggestion(values.category, suggestionsFor('category')),
      size: normalizeToSuggestion(values.size, suggestionsFor('size')),
      color: normalizeToSuggestion(values.color, suggestionsFor('color')),
    }
    try {
      if (product) {
        await updateProduct.mutateAsync({ id: product.id, values: { ...normalized, status, photos } })
        onClose()
      } else {
        const created = await createProduct.mutateAsync({ ...normalized, photos })
        onCreated?.(created)
        if (addAnotherAfterSave) {
          setPhotos([])
          reset({
            locationId: staff?.locationId ?? '',
            name: '',
            category: normalized.category,
            size: normalized.size,
            color: normalized.color,
            rentalPrice: normalized.rentalPrice,
            depositAmount: normalized.depositAmount,
            description: normalized.description,
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

  // These three repeat across almost every piece in a shop, so offering what
  // is already in use keeps the catalogue from drifting into "Festa"/"festa".
  const suggestionsFor = (field: 'category' | 'size' | 'color') =>
    (allProducts ?? []).map((item) => item[field]).filter((entry): entry is string => Boolean(entry))

  // The code identifies the piece the way the shop says it out loud, so it
  // belongs where the piece is named, not buried in a field list. A new
  // product has none yet — the server assigns it on create.
  const drawerTitle = product
    ? product.code == null
      ? t('editTitle')
      : `${t('editTitle')} · ${t('codePrefix')}${product.code}`
    : t('newTitle')

  return (
    <Sheet open onOpenChange={(next) => !next && discardGuard.requestClose()}>
      <SheetContent className="w-80" aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{drawerTitle}</SheetTitle>
          <SheetClose aria-label={t('common:actions.close', { ns: 'common' })}>
            <X size={18} />
          </SheetClose>
        </SheetHeader>
        <SheetBody>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
        <input type="hidden" {...register('locationId')} />
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('fields.name')}<RequiredMark /></span>
          <Input
            {...register('name')}
            aria-required="true"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'product-name-error' : undefined}
          />
          {errors.name && <span id="product-name-error" className="text-xs text-destructive">{t('validation.nameRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('fields.category')}<RequiredMark /></span>
          <Controller
            name="category"
            control={control}
            render={({ field }) => (
              <AutocompleteInput
                value={field.value ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                suggestions={suggestionsFor('category')}
                aria-label={t('fields.category')}
                aria-required="true"
                aria-invalid={errors.category ? true : undefined}
                aria-describedby={errors.category ? 'product-category-error' : undefined}
              />
            )}
          />
          {errors.category && <span id="product-category-error" className="text-xs text-destructive">{t('validation.categoryRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('fields.size')}<RequiredMark /></span>
          <Controller
            name="size"
            control={control}
            render={({ field }) => (
              <AutocompleteInput
                value={field.value ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                suggestions={suggestionsFor('size')}
                aria-label={t('fields.size')}
                aria-required="true"
                aria-invalid={errors.size ? true : undefined}
                aria-describedby={errors.size ? 'product-size-error' : undefined}
              />
            )}
          />
          {errors.size && <span id="product-size-error" className="text-xs text-destructive">{t('validation.sizeRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('fields.color')}<RequiredMark /></span>
          <Controller
            name="color"
            control={control}
            render={({ field }) => (
              <AutocompleteInput
                value={field.value ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                suggestions={suggestionsFor('color')}
                aria-label={t('fields.color')}
                aria-required="true"
                aria-invalid={errors.color ? true : undefined}
                aria-describedby={errors.color ? 'product-color-error' : undefined}
              />
            )}
          />
          {errors.color && <span id="product-color-error" className="text-xs text-destructive">{t('validation.colorRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('fields.rentalPrice')}<RequiredMark /></span>
          <Controller
            name="rentalPrice"
            control={control}
            render={({ field }) => (
              <CurrencyInput
                value={field.value}
                onChange={field.onChange}
                id="rentalPrice"
                aria-label={t('fields.rentalPrice')}
                aria-required="true"
                aria-invalid={errors.rentalPrice ? true : undefined}
                aria-describedby={errors.rentalPrice ? 'product-rental-price-error' : undefined}
              />
            )}
          />
          {errors.rentalPrice && <span id="product-rental-price-error" className="text-xs text-destructive">{t('validation.rentalPriceInvalid')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.depositAmount')}
          <Controller
            name="depositAmount"
            control={control}
            render={({ field }) => (
              <CurrencyInput
                value={field.value}
                onChange={field.onChange}
                id="depositAmount"
                aria-label={t('fields.depositAmount')}
                aria-invalid={errors.depositAmount ? true : undefined}
                aria-describedby={errors.depositAmount ? 'product-deposit-amount-error' : undefined}
              />
            )}
          />
          {errors.depositAmount && <span id="product-deposit-amount-error" className="text-xs text-destructive">{t('validation.depositAmountInvalid')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.description')}
          <Input {...register('description')} />
        </label>
        {product && (
          <label className="flex flex-col gap-1 text-sm">
            {t('fields.status')}
            <Select value={status} onChange={(event) => setStatus(event.target.value as ProductStatus)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`status.${option}`)}
                </option>
              ))}
            </Select>
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
                  <span className="flex-1 truncate text-muted-foreground">{url}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removePhoto(index)}>
                    {t('photos.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {!product && allowSaveAndAddAnother && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={addAnotherAfterSave}
              onChange={(event) => setAddAnotherAfterSave(event.target.checked)}
            />
            {t('common:actions.saveAndAddAnother', { ns: 'common' })}
          </label>
        )}
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
            <Button type="button" variant="secondary" onClick={discardGuard.requestClose}>
              {t('common:actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" disabled={createProduct.isPending || updateProduct.isPending}>
              {t('common:actions.save', { ns: 'common' })}
            </Button>
          </div>
        </div>
      </form>
      {product && (
        <ConfirmDialog
          open={confirmingDelete}
          title={t('common:confirmDelete.title', { ns: 'common', name: product.name })}
          message={t('common:confirmDelete.message', { ns: 'common' })}
          confirmLabel={t('common:actions.delete', { ns: 'common' })}
          cancelLabel={t('common:actions.cancel', { ns: 'common' })}
          confirmVariant="danger"
          confirmDisabled={deleteProduct.isPending}
          onConfirm={handleDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
      <ConfirmDialog
        open={discardGuard.isConfirmingDiscard}
        title={t('common:confirmDiscard.title', { ns: 'common' })}
        message={t('common:confirmDiscard.message', { ns: 'common' })}
        confirmLabel={t('common:confirmDiscard.confirm', { ns: 'common' })}
        cancelLabel={t('common:confirmDiscard.cancel', { ns: 'common' })}
        confirmVariant="danger"
        onConfirm={discardGuard.confirmDiscard}
        onCancel={discardGuard.cancelDiscard}
      />
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
