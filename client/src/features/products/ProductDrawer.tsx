import { useRef, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
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
import { fileToJpegDataUrl, isPendingPhoto, MAX_PHOTO_FILE_BYTES } from '../../lib/imageFile.ts'
import { productSchema, type Product, type ProductFormValues, type ProductStatus } from './productSchemas.ts'
import {
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useProducts,
  useUploadProductPhotos,
} from './useProducts.ts'

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
  /**
   * The piece's photos in the order they will be stored, holding two kinds of
   * entry: paths already on the server (`/api/products/...`) and photos picked
   * in this drawer but not yet sent (`data:image/jpeg;...`). Keeping both in
   * one ordered array is what makes reordering and removing work the same
   * either way — and what lets a photo be picked and then thought better of
   * without anything having been written.
   */
  const [photos, setPhotos] = useState<string[]>(product?.photos ?? [])
  const [addAnotherAfterSave, setAddAnotherAfterSave] = useState(false)
  /**
   * Set the moment a NEW product's row is created, before its photos are
   * uploaded. If the upload then fails (oversized batch, network drop), the
   * drawer stays open with the row already committed server-side — without
   * this, pressing "Salvar" again would call createProduct a second time and
   * mint a second row with a second sequential code. Every retry after the
   * first success patches this same row instead.
   */
  const [createdProduct, setCreatedProduct] = useState<Product | null>(null)
  const uploadPhotos = useUploadProductPhotos()
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  // status and photos live outside react-hook-form, so isDirty alone
  // under-reports: without this the user could still lose an added photo.
  const initialPhotos = product?.photos ?? []
  const hasUnsavedChanges =
    isDirty ||
    status !== (product?.status ?? 'active') ||
    photos.length !== initialPhotos.length ||
    photos.some((url, index) => url !== initialPhotos[index])
  const discardGuard = useUnsavedChangesGuard({ isDirty: hasUnsavedChanges, onConfirmDiscard: onClose })

  async function addPickedPhotos(files: FileList | null) {
    if (!files || files.length === 0) return
    const converted: string[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        showErrorToast(t('photos.invalidType', { name: file.name }))
        continue
      }
      // Checked before decoding: a 60 MB raw photo should be refused by name,
      // not after the browser has spent a second and a half loading it.
      if (file.size > MAX_PHOTO_FILE_BYTES) {
        showErrorToast(t('photos.tooLarge', { name: file.name }))
        continue
      }
      try {
        converted.push(await fileToJpegDataUrl(file))
      } catch {
        showErrorToast(t('photos.readFailed', { name: file.name }))
      }
    }
    if (converted.length > 0) {
      setPhotos((current) => [...current, ...converted])
    }
    // Cleared so picking the same file twice in a row still fires a change.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removePhoto(index: number) {
    setPhotos((current) => current.filter((_, i) => i !== index))
  }

  function movePhoto(index: number, delta: number) {
    setPhotos((current) => {
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  // Matches the server's own uploadPhotosSchema (signingValidation.ts) so a
  // batch this large is chunked before it hits that limit, instead of the
  // server rejecting it outright and the picker losing every photo at once.
  const PHOTO_BATCH_MAX_COUNT = 20
  // Leaves headroom under the route's 12 MB JSON body limit — several
  // full-size compressed photos can individually pass the per-photo cap and
  // still sum past the request's own ceiling.
  const PHOTO_BATCH_MAX_BASE64_LENGTH = 8_000_000

  /**
   * Sends whatever was picked in this drawer and returns the piece's photos in
   * the order shown on screen.
   *
   * Split into chunks bounded by both count and combined length — a picker
   * selection large enough to exceed either used to go in one request and
   * fail as a single all-or-nothing batch, discarding every photo including
   * ones well within either limit on their own. Each successful chunk is
   * folded into local state immediately, so if a later chunk fails, only the
   * photos IT carried are left pending — not the ones already safely on the
   * server.
   *
   * The upload appends, so for a piece that had photos already the order it
   * produces is "old ones, then new ones" — which is only the intended order
   * if nothing was reordered. The resolved array is therefore written again by
   * the normal save below, which is the single authority on order.
   */
  async function resolvePhotos(productId: string): Promise<string[]> {
    const pendingIndexes: number[] = []
    photos.forEach((entry, index) => {
      if (isPendingPhoto(entry)) pendingIndexes.push(index)
    })
    if (pendingIndexes.length === 0) return photos

    const chunks: number[][] = []
    let current: number[] = []
    let currentLength = 0
    for (const index of pendingIndexes) {
      const entryLength = photos[index].length
      const wouldOverflow =
        current.length >= PHOTO_BATCH_MAX_COUNT || currentLength + entryLength > PHOTO_BATCH_MAX_BASE64_LENGTH
      if (wouldOverflow && current.length > 0) {
        chunks.push(current)
        current = []
        currentLength = 0
      }
      current.push(index)
      currentLength += entryLength
    }
    if (current.length > 0) chunks.push(current)

    let latest = photos
    for (const chunkIndexes of chunks) {
      const chunkPhotos = chunkIndexes.map((index) => latest[index])
      const { photos: stored } = await uploadPhotos.mutateAsync({ id: productId, photos: chunkPhotos })
      const storedForChunk = stored.slice(stored.length - chunkPhotos.length)
      const next = [...latest]
      chunkIndexes.forEach((index, position) => {
        next[index] = storedForChunk[position]
      })
      latest = next
      setPhotos(latest)
    }
    return latest
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
        const resolvedPhotos = await resolvePhotos(product.id)
        await updateProduct.mutateAsync({ id: product.id, values: { ...normalized, status, photos: resolvedPhotos } })
        onClose()
      } else {
        // A piece has to exist before a photo can belong to it, so the row is
        // created first and the picked photos follow. Nothing is on screen but
        // the two together. createdProduct is set the instant the row exists —
        // if the photo upload then fails, a retry patches that same row rather
        // than creating a second one (see the state's own comment above).
        const base = createdProduct ?? (await createProduct.mutateAsync({
          ...normalized,
          photos: photos.filter((entry) => !isPendingPhoto(entry)),
        }))
        if (createdProduct === null) setCreatedProduct(base)

        const hasPending = photos.some(isPendingPhoto)
        // Resolved on its own line, NOT inside the optional call below: `f?.(x)`
        // does not evaluate `x` when `f` is nullish, and onCreated is optional —
        // inlining the upload there meant a piece created from Produtos (which
        // passes no callback in the photo case) silently kept none of the
        // photos that had just been picked for it.
        const createdWithPhotos = hasPending
          ? { ...base, photos: await resolvePhotos(base.id) }
          : // Left exactly as the server returned it when nothing was picked —
            // callers compare against that object.
            base
        onCreated?.(createdWithPhotos)
        if (addAnotherAfterSave) {
          setCreatedProduct(null)
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
      {/*
        w-full below sm so a narrow window gets the whole width rather than
        overflowing it (SheetContent has no built-in width cap of its own,
        unlike Dialog). From sm up, width scales with the viewport instead of
        sitting at one fixed pixel value on every screen — this drawer holds
        a full form plus the photo list, which felt cramped at a flat 320px.
      */}
      <SheetContent className="w-full sm:w-[min(85vw,28rem)]" aria-describedby={undefined}>
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
          {/*
            A real file picker, not a URL field. Nobody in the shop has a URL
            for a dress they just photographed — the previous input could only
            be used by someone who had already uploaded the file somewhere
            else, which is not a thing this app ever offered. The native input
            stays out of the layout and is driven by a button styled like
            every other control here.
          */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            aria-label={t('photos.add')}
            onChange={(event) => void addPickedPhotos(event.target.files)}
          />
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>
              {t('photos.add')}
            </Button>
            <span className="text-xs text-muted-foreground">{t('photos.hint')}</span>
          </div>
          {photos.length === 0 ? (
            <span className="mt-1 text-xs text-muted-foreground">{t('photos.empty')}</span>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              {photos.map((url, index) => (
                <li key={url.slice(0, 64) + index} className="flex items-center gap-2 text-xs">
                  <PhotoThumbnail url={url} />
                  {/*
                    The filename, not the whole `/api/products/<uuid>/photos/…`
                    path: truncated to the row's width, the path is entirely
                    the part that is identical for every photo of the piece.
                  */}
                  <span className="flex-1 truncate text-muted-foreground">
                    {isPendingPhoto(url) ? t('photos.pending') : url.split('/').pop()}
                  </span>
                  {/*
                    Order matters: the first photo is the one every list, card
                    and calendar cell in the app shows for this piece.
                  */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('photos.moveUp')}
                    disabled={index === 0}
                    onClick={() => movePhoto(index, -1)}
                  >
                    <ChevronUp size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('photos.moveDown')}
                    disabled={index === photos.length - 1}
                    onClick={() => movePhoto(index, 1)}
                  >
                    <ChevronDown size={14} />
                  </Button>
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
