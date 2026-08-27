import { useState } from 'react'
import { useForm, Controller, useFieldArray, useWatch, type Path } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { CurrencyInput } from '../../components/ui/currency-input.tsx'
import { DateInput } from '../../components/ui/date-input.tsx'
import { Select } from '../../components/ui/select.tsx'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogBody,
  DialogActions,
} from '../../components/ui/dialog.tsx'
import { ConfirmDialog } from '../../components/ui/confirm-dialog.tsx'
import { RequiredMark } from '../../components/ui/required-mark.tsx'
import { SectionLabel } from '../../components/ui/toolbar.tsx'
import { cn } from '../../lib/cn.ts'
import { showErrorToast } from '../../lib/toast.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { formatCurrency, getLocaleConfig } from '../../lib/locale.ts'
import { useUnsavedChangesGuard } from '../../lib/useUnsavedChangesGuard.ts'
import { getMissingRequiredFields } from '../../lib/clientReadiness.ts'
import { getPaymentMethods } from '../../lib/paymentMethodTemplate.ts'
import { useClients } from '../clients/useClients.ts'
import { ClientDrawer } from '../clients/ClientDrawer.tsx'
import { ClientCombobox } from '../clients/ClientCombobox.tsx'
import type { Client } from '../clients/clientSchemas.ts'
import { useProducts } from '../products/useProducts.ts'
import { useProductAvailability } from '../allocations/useAllocations.ts'
import type { Product } from '../products/productSchemas.ts'
import { ProductCombobox } from '../products/ProductCombobox.tsx'
import { ProductDrawer } from '../products/ProductDrawer.tsx'
import { newContractSchema, type NewContractFormValues } from './contractSchemas.ts'
import { useCreateContract } from './useContracts.ts'

function ItemRow({
  index,
  control,
  activeProducts,
  setValue,
  onRemove,
  showRemove,
  productIdError,
  checkoutDateError,
  dueDateError,
  onCreateProduct,
}: {
  index: number
  control: ReturnType<typeof useForm<NewContractFormValues>>['control']
  activeProducts: Product[]
  setValue: ReturnType<typeof useForm<NewContractFormValues>>['setValue']
  onRemove: () => void
  showRemove: boolean
  productIdError?: string
  checkoutDateError?: string
  dueDateError?: string
  onCreateProduct: (index: number, name: string) => void
}) {
  const { t } = useTranslation('contracts')
  const productId = useWatchField(control, `items.${index}.productId`)
  const checkoutDate = useWatchField(control, `items.${index}.checkoutDate`)
  const dueDate = useWatchField(control, `items.${index}.dueDate`)
  const availability = useProductAvailability(productId, checkoutDate, dueDate)

  return (
    <div className="flex flex-col gap-2 border-b border-hairline bg-card p-2.5 last:border-b-0">
      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span>{t('fields.product')}<RequiredMark /></span>
          <Controller
            name={`items.${index}.productId`}
            control={control}
            render={({ field }) => (
              <ProductCombobox
                ref={field.ref}
                products={activeProducts}
                value={field.value}
                onSelect={(id) => {
                  field.onChange(id)
                  // Staff should not have to remember each piece's price. The
                  // field stays editable — a discount or a surcharge is still
                  // just typing over it — but it starts from the real number.
                  const picked = activeProducts.find((product) => product.id === id)
                  if (picked) {
                    setValue(`items.${index}.priceCharged`, picked.rentalPrice, { shouldDirty: true })
                  }
                }}
                onCreateNew={(name) => onCreateProduct(index, name)}
                aria-label={t('fields.product')}
                aria-required="true"
                aria-invalid={productIdError ? true : undefined}
              />
            )}
          />
          {productIdError && <span className="text-xs text-destructive">{productIdError}</span>}
        </label>
        {showRemove && (
          <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={t('items.remove')}>
            <X size={16} />
          </Button>
        )}
      </div>
      {/*
        Dates and price on one line rather than stacked. The dialog holds one
        height now, so a piece row's height is what decides how many pieces you
        can see at once — and at three stacked lines it was less than one.
      */}
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span>{t('fields.checkoutDate')}<RequiredMark /></span>
          <Controller
            name={`items.${index}.checkoutDate`}
            control={control}
            render={({ field }) => (
              <DateInput
                value={field.value}
                onChange={field.onChange}
                aria-label={t('fields.checkoutDate')}
                aria-required="true"
                aria-invalid={checkoutDateError ? true : undefined}
              />
            )}
          />
          {checkoutDateError && <span className="text-xs text-destructive">{checkoutDateError}</span>}
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span>{t('fields.dueDate')}<RequiredMark /></span>
          <Controller
            name={`items.${index}.dueDate`}
            control={control}
            render={({ field }) => (
              <DateInput
                value={field.value}
                onChange={field.onChange}
                aria-label={t('fields.dueDate')}
                aria-required="true"
                aria-invalid={dueDateError ? true : undefined}
              />
            )}
          />
          {dueDateError && <span className="text-xs text-destructive">{dueDateError}</span>}
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {t('fields.priceCharged')}
          <Controller
            name={`items.${index}.priceCharged`}
            control={control}
            render={({ field }) => (
              <CurrencyInput value={field.value} onChange={field.onChange} aria-label={t('fields.priceCharged')} />
            )}
          />
        </label>
      </div>
      {productId && checkoutDate && dueDate && availability.data?.available === false && (
        <span className="text-xs text-destructive">{t('unavailableProduct')}</span>
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

export function NewContractForm({
  onClose,
  clientId: preselectedClientId,
}: {
  onClose: () => void
  /**
   * Opens with this client already chosen — the Clientes screen starts a
   * contract for the person on screen, and retyping the name you just had
   * selected is the kind of step that makes staff skip the shortcut. An id
   * that no longer exists simply leaves the field empty, since the combobox
   * resolves it against the loaded clients rather than trusting it.
   */
  clientId?: string
}) {
  const { t } = useTranslation('contracts')
  const { locale } = useLocale()
  const { data: clients } = useClients()
  const { data: products } = useProducts()
  const createContract = useCreateContract()
  const [completingClient, setCompletingClient] = useState<Client | null>(null)
  const [creatingClientName, setCreatingClientName] = useState<string | null>(null)
  const [creatingProduct, setCreatingProduct] = useState<{ index: number; name: string } | null>(null)
  const [pendingSubmitValues, setPendingSubmitValues] = useState<NewContractFormValues | null>(null)

  const {
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<NewContractFormValues>({
    resolver: zodResolver(newContractSchema),
    defaultValues: {
      clientId: preselectedClientId ?? '',
      eventDate: '',
      paymentMethod: '',
      items: [{ productId: '', checkoutDate: '', dueDate: '', priceCharged: 0 }],
    },
  })

  const items = useFieldArray({ control, name: 'items' })
  // `isDirty` compares against defaultValues, and the preselected client IS
  // a default value, so an untouched dialog opened from Clientes stays clean
  // and closes without a discard prompt.
  const discardGuard = useUnsavedChangesGuard({ isDirty, onConfirmDiscard: onClose })
  const selectedClientId = watch('clientId')
  const selectedClient = clients?.find((client) => client.id === selectedClientId) ?? null
  const missingFields = selectedClient ? getMissingRequiredFields(selectedClient, locale) : []

  async function submitContract(values: NewContractFormValues) {
    try {
      await createContract.mutateAsync(values)
      onClose()
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'UNKNOWN'
      showErrorToast(t([`errors.${code}`, `common:errors.${code}`, 'common:errors.UNKNOWN']))
    }
  }

  // The client-readiness banner above the form is easy to miss once the
  // rest of the form is filled in — one last checkpoint before an
  // incomplete client's contract is actually saved, rather than a silent
  // pass-through.
  async function onSubmit(values: NewContractFormValues) {
    if (missingFields.length > 0) {
      setPendingSubmitValues(values)
      return
    }
    await submitContract(values)
  }

  async function confirmSubmitAnyway() {
    if (!pendingSubmitValues) return
    const values = pendingSubmitValues
    setPendingSubmitValues(null)
    await submitContract(values)
  }

  const activeProducts = products?.filter((product) => product.status === 'active') ?? []
  const watchedItems = watch('items')
  const itemsTotal = (watchedItems ?? []).reduce((sum, item) => sum + (Number(item?.priceCharged) || 0), 0)
  const currency = getLocaleConfig(locale).currency
  const paymentMethods = getPaymentMethods(locale)

  return (
    <>
    <Dialog open onOpenChange={(next) => !next && discardGuard.requestClose()}>
      {/*
        One dialog, two columns — the format chosen in the design study.
        This form is filled in several times a day by the same person, so
        everything stays visible and reachable by Tab: nothing is hidden
        behind wizard steps that would cost four extra clicks on every
        contract, forever, and would block the thing the shop actually does
        — going back two steps because the client changed her mind about a
        piece.

        The study's one exception: past four pieces the dialog widens to
        page width and keeps the same fields in the same places. One
        format, two sizes — never two different forms, which is how the
        contract flow reached its previous state.

        The height does not grow with CONTENT: the dialog used to get taller
        with every piece and every parcela until the Salvar button walked off
        the bottom of a laptop screen — on the one form this shop fills in
        most. Peças and Parcelas each scroll inside their own bordered box
        instead, so the header, the totals and the two buttons never move,
        no matter how many rows either list holds.

        It DOES scale with the SCREEN, though — both dimensions are viewport
        percentages capped at a sensible maximum, not fixed rem values, so a
        1440p monitor gets a dialog sized for it instead of the same box a
        1280×800 laptop gets, and a short/narrow window still shrinks to fit
        without the old separate `max-h` override.
      */}
      <DialogContent
        showCloseButton={false}
        className={cn(
          'flex h-[min(85vh,46rem)] flex-col gap-0 overflow-hidden p-0',
          items.fields.length > 4 ? 'sm:max-w-[min(90vw,76rem)]' : 'sm:max-w-[min(90vw,50rem)]',
        )}
      >
        <div className="flex flex-shrink-0 items-start justify-between gap-4 px-5 pt-4 pb-3.5">
          <div className="flex flex-col gap-0.5">
            <DialogTitle>{t('newContract')}</DialogTitle>
            <DialogDescription className="text-meta text-muted-foreground">
              {t('newContractSubtitle')}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label={t('common:actions.close', { ns: 'common' })}
            className="inline-flex size-7 items-center justify-center rounded-control text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
          >
            <X size={16} />
          </DialogClose>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
        {/*
          The body itself no longer scrolls — the two lists inside it do. A
          single scroller here is what let the whole form grow instead: adding
          a fifth parcela pushed the Peças section out of view rather than
          paging within it.
        */}
        <DialogBody className="grid grid-cols-2 gap-5 overflow-hidden px-5 pb-4">
          <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto">
          <SectionLabel>{t('sections.clientAndEvent')}</SectionLabel>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t('fields.client')}<RequiredMark /></span>
            <Controller
              name="clientId"
              control={control}
              render={({ field }) => (
                <ClientCombobox
                  ref={field.ref}
                  clients={clients ?? []}
                  value={field.value}
                  onSelect={field.onChange}
                  onCreateNew={(name) => setCreatingClientName(name)}
                  aria-label={t('fields.client')}
                  aria-required="true"
                  aria-invalid={errors.clientId ? true : undefined}
                />
              )}
            />
            {errors.clientId && <span className="text-xs text-destructive">{t('validation.clientRequired')}</span>}
          </label>
          {selectedClient && missingFields.length > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-warning-border bg-warning p-2 text-xs text-warning-foreground">
              <span>{t('clientReadiness.missing', { fields: missingFields.join(', ') })}</span>
              <Button type="button" size="sm" variant="secondary" onClick={() => setCompletingClient(selectedClient)}>
                {t('clientReadiness.complete')}
              </Button>
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span>{t('fields.eventDate')}<RequiredMark /></span>
            <Controller
              name="eventDate"
              control={control}
              render={({ field }) => (
                <DateInput
                  value={field.value}
                  onChange={field.onChange}
                  aria-label={t('fields.eventDate')}
                  aria-required="true"
                  aria-invalid={errors.eventDate ? true : undefined}
                />
              )}
            />
            {errors.eventDate && (
              <span className="text-xs text-destructive">
                {t(errors.eventDate.type === 'custom' ? 'validation.eventDateInvalid' : 'validation.eventDateRequired')}
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t('fields.paymentMethod')}<RequiredMark /></span>
            {/*
              Controller-driven, not register-driven, even though this is a
              plain native <select>: react-hook-form's shouldFocusError walk
              always focuses a register()-registered field over a
              Controller-registered one on submit, regardless of JSX order
              — register() calls run synchronously during the parent's own
              render, while Controller's registration only runs when React
              renders that child component, a strictly later step. With
              clientId/productId already Controller-driven, leaving this the
              lone register()ed field meant it silently won the walk instead
              of whichever field was actually first and invalid. Verified via
              an isolated RHF repro outside this component, independent of
              EntityCombobox/Radix.
            */}
            <Controller
              name="paymentMethod"
              control={control}
              render={({ field }) => (
                <Select {...field} aria-label={t('fields.paymentMethod')} aria-required="true">
                  <option value="">—</option>
                  {paymentMethods.map((method) => (
                    <option key={method} value={method}>{method}</option>
                  ))}
                </Select>
              )}
            />
            {errors.paymentMethod && <span className="text-xs text-destructive">{t('validation.paymentMethodRequired')}</span>}
          </label>
          </div>

          {/*
            Peças now has the whole right column to itself — Parcelas is
            gone, since a payment plan no longer exists to build. This is
            the cramped edge the design study called out: four fields per
            row against a two-thirds-height box.
          */}
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <SectionLabel>{t('items.title')}</SectionLabel>
              <span className="text-meta text-muted-foreground">
                {t(items.fields.length === 1 ? 'items.countOne' : 'items.countOther', {
                  count: items.fields.length,
                })}
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel border border-border">
            <div className="min-h-0 flex-1 overflow-y-auto">
            {items.fields.map((field, index) => (
              <ItemRow
                key={field.id}
                index={index}
                control={control}
                activeProducts={activeProducts}
                setValue={setValue}
                onRemove={() => items.remove(index)}
                showRemove={items.fields.length > 1}
                onCreateProduct={(idx, name) => setCreatingProduct({ index: idx, name })}
                productIdError={
                  errors.items?.[index]?.productId ? t('validation.productRequired') : undefined
                }
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
            </div>
            {/*
              Pinned to the bottom of this box, not of the dialog: the button
              that adds a piece belongs to the list of pieces, and stays
              reachable however far down that list you have scrolled.
            */}
            <button
              type="button"
              onClick={() => items.append({ productId: '', checkoutDate: '', dueDate: '', priceCharged: 0 })}
              className="flex w-full flex-shrink-0 items-center gap-2 border-t border-hairline bg-surface-sunken px-2.5 py-2 text-left text-[13px] font-medium text-primary hover:bg-secondary"
            >
              {t('items.add')}
            </button>
            </div>
          </div>
        </DialogBody>
        <DialogActions className="justify-between">
          {/*
            No payment is collected here — that happens on the contract's own
            screen, once it exists, the same way every later payment is
            logged too. The footer says so, rather than leaving her to
            wonder where the deposit she is about to collect goes.
          */}
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="text-meta text-muted-foreground">{t('items.total')}</span>
            <span className="tabular text-[15px] font-semibold">{formatCurrency(itemsTotal, locale, currency)}</span>
            <span className="text-meta text-muted-foreground">{t('paymentsLoggedAfterSave')}</span>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={discardGuard.requestClose}>
              {t('common:actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" disabled={createContract.isPending}>
              {t('saveContract')}
            </Button>
          </div>
        </DialogActions>
        </form>
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
        <ConfirmDialog
          open={pendingSubmitValues !== null}
          title={t('clientReadiness.confirmSaveTitle')}
          message={t('clientReadiness.confirmSaveMessage', { fields: missingFields.join(', ') })}
          confirmLabel={t('clientReadiness.confirmSaveConfirm')}
          cancelLabel={t('common:actions.cancel', { ns: 'common' })}
          confirmVariant="danger"
          confirmDisabled={createContract.isPending}
          onConfirm={confirmSubmitAnyway}
          onCancel={() => setPendingSubmitValues(null)}
        />
      </DialogContent>
    </Dialog>
    {completingClient && <ClientDrawer client={completingClient} onClose={() => setCompletingClient(null)} />}
    {creatingClientName !== null && (
      <ClientDrawer
        client={null}
        initialName={creatingClientName}
        onClose={() => setCreatingClientName(null)}
        onCreated={(newClient) => {
          setValue('clientId', newClient.id, { shouldDirty: true, shouldValidate: true })
          setCreatingClientName(null)
        }}
      />
    )}
    {creatingProduct && (
      <ProductDrawer
        product={null}
        initialName={creatingProduct.name}
        allowSaveAndAddAnother={false}
        onClose={() => setCreatingProduct(null)}
        onCreated={(newProduct) => {
          setValue(`items.${creatingProduct.index}.productId`, newProduct.id, { shouldDirty: true, shouldValidate: true })
          setValue(`items.${creatingProduct.index}.priceCharged`, newProduct.rentalPrice, { shouldDirty: true })
          setCreatingProduct(null)
        }}
      />
    )}
    </>
  )
}
