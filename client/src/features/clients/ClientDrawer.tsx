import { useState } from 'react'
import { useForm, Controller, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { PhoneInput } from '../../components/ui/phone-input.tsx'
import { MaskedTextInput } from '../../components/ui/masked-text-input.tsx'
import { AutocompleteInput } from '../../components/ui/autocomplete-input.tsx'
import { ConfirmDialog } from '../../components/ui/confirm-dialog.tsx'
import { RequiredMark } from '../../components/ui/required-mark.tsx'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose, SheetBody } from '../../components/ui/sheet.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { useUnsavedChangesGuard } from '../../lib/useUnsavedChangesGuard.ts'
import { getClientFieldTemplate } from '../../lib/clientFieldTemplates.ts'
import { getFieldMask } from '../../lib/clientFieldMasks.ts'
import { foldForSearch, normalizeToSuggestion } from '../../lib/autocompleteMatch.ts'
import { clientSchema, type Client, type ClientFormValues } from './clientSchemas.ts'
import { useClients, useCreateClient, useUpdateClient, useDeleteClient } from './useClients.ts'

export function ClientDrawer({
  client,
  onClose,
  initialName,
  onCreated,
}: {
  client: Client | null
  onClose: () => void
  initialName?: string
  onCreated?: (client: Client) => void
}) {
  const { t } = useTranslation('clients')
  const { locale } = useLocale()
  const { data: allClients } = useClients()
  const createClient = useCreateClient()
  const updateClient = useUpdateClient()
  const deleteClient = useDeleteClient()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmingRemoveField, setConfirmingRemoveField] = useState<{
    kind: 'identityDocuments' | 'addressLines'
    index: number
  } | null>(null)

  const template = getClientFieldTemplate(locale)
  const defaultIdentityDocuments = client
    ? client.identityDocuments
    : template.identityDocuments.map((entry) => ({ label: entry.label, value: '', maskKey: entry.maskKey ?? null }))
  const defaultAddressLines = client
    ? client.addressLines
    : template.addressLines.map((entry, index) => ({
        label: entry.label,
        value: '',
        sortOrder: index,
        maskKey: entry.maskKey ?? null,
      }))

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isDirty },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: client ?? {
      name: initialName ?? '',
      phone: '',
      email: '',
      notes: '',
      identityDocuments: defaultIdentityDocuments,
      addressLines: defaultAddressLines,
    },
  })

  const identityDocuments = useFieldArray({ control, name: 'identityDocuments' })
  const addressLines = useFieldArray({ control, name: 'addressLines' })
  const discardGuard = useUnsavedChangesGuard({ isDirty, onConfirmDiscard: onClose })

  // Address lines repeat across the shop's clientele (same cities,
  // neighborhoods, states), so offering what's already on file speeds up
  // entry the same way ProductDrawer's category/size/color suggestions do.
  function addressSuggestionsFor(label: string): string[] {
    return (allClients ?? [])
      .flatMap((otherClient) => otherClient.addressLines ?? [])
      .filter((line) => line.label === label)
      .map((line) => line.value)
      .filter((value): value is string => Boolean(value))
  }

  /**
   * Whether a row is one of the location's expected fields.
   *
   * By LABEL, never by array position. Stored rows come back in insertion
   * order, so a client saved with RG but no CPF shifts every later row up by
   * one — and an index comparison then said RG was not a template field. It
   * rendered white and editable instead of grey and locked, and one click on
   * ✕ wiped it with no confirmation. An address saved without "Endereço"
   * unlocked Bairro, Cidade and Estado all at once.
   *
   * The unlocked label is the second-order damage: she can retype "Bairro" as
   * "Barrio", and clientReadiness matches by label, so Contratos then reports
   * a missing field on a fully filled address.
   */
  // Case- and accent-insensitively, matching how clientReadiness decides the
  // same question. Comparing exactly meant a stored `cpf` row counted as
  // FILLED for readiness while rendering unlocked here — so she could rename
  // it and break the very invariant this protects.
  function isTemplateDocument(label: string) {
    return template.identityDocuments.some((entry) => foldForSearch(entry.label) === foldForSearch(label))
  }

  function isTemplateAddressLine(label: string) {
    return template.addressLines.some((entry) => foldForSearch(entry.label) === foldForSearch(label))
  }

  // A stray click on the same-size remove icon shouldn't be able to drop an
  // expected field without at least one chance to back out. Freely-added
  // extra rows carry no such expectation and remove immediately.
  function requestRemoveIdentityDocument(index: number) {
    if (isTemplateDocument(identityDocuments.fields[index].label)) {
      setConfirmingRemoveField({ kind: 'identityDocuments', index })
    } else {
      identityDocuments.remove(index)
    }
  }

  function requestRemoveAddressLine(index: number) {
    if (isTemplateAddressLine(addressLines.fields[index].label)) {
      setConfirmingRemoveField({ kind: 'addressLines', index })
    } else {
      addressLines.remove(index)
    }
  }

  function confirmRemoveField() {
    if (!confirmingRemoveField) return
    if (confirmingRemoveField.kind === 'identityDocuments') {
      identityDocuments.remove(confirmingRemoveField.index)
    } else {
      addressLines.remove(confirmingRemoveField.index)
    }
    setConfirmingRemoveField(null)
  }

  const removingFieldLabel =
    confirmingRemoveField &&
    (confirmingRemoveField.kind === 'identityDocuments'
      ? identityDocuments.fields[confirmingRemoveField.index]?.label
      : addressLines.fields[confirmingRemoveField.index]?.label)

  function showError(error: unknown) {
    const code = (error as { code?: string }).code ?? 'UNKNOWN'
    showErrorToast(t([`errors.${code}`, `common:errors.${code}`, 'common:errors.UNKNOWN']))
  }

  /**
   * Nothing here may fail silently. A row that has a value but no label is
   * rejected by clientSchema's per-row refine, and that error had nowhere to
   * render: Salvar stayed enabled, the drawer stayed open, and not one word
   * appeared on screen — indistinguishable from a frozen app, with a customer
   * waiting. The row errors below say which row and why; this says the save
   * did not happen at all, for anyone who missed the red text further down.
   */
  function onInvalid() {
    showErrorToast(t('validation.formInvalid'))
  }

  async function onSubmit(values: ClientFormValues) {
    const normalized: ClientFormValues = {
      ...values,
      identityDocuments: values.identityDocuments
        .filter((doc) => doc.value.trim() !== '')
        .map((doc) => ({ ...doc, value: doc.value.trim() })),
      addressLines: values.addressLines
        .filter((line) => line.value.trim() !== '')
        // Snap to whatever casing/accents are already on file for the same
        // value (e.g. "piedade" -> "Piedade"), so the same city doesn't end
        // up stored two different ways depending on who typed it.
        .map((line, index) => ({
          ...line,
          value: normalizeToSuggestion(line.value, addressSuggestionsFor(line.label)),
          sortOrder: index,
        })),
    }
    try {
      if (client) {
        await updateClient.mutateAsync({ id: client.id, values: normalized })
      } else {
        const created = await createClient.mutateAsync(normalized)
        onCreated?.(created)
      }
      onClose()
    } catch (error) {
      showError(error)
    }
  }

  async function handleDelete() {
    if (!client) return
    try {
      await deleteClient.mutateAsync(client.id)
      onClose()
    } catch (error) {
      showError(error)
    } finally {
      setConfirmingDelete(false)
    }
  }

  const drawerTitle = client ? t('editTitle') : t('newTitle')

  return (
    <Sheet open onOpenChange={(next) => !next && discardGuard.requestClose()}>
      {/*
        w-full below sm so a narrow window gets the whole width rather than
        overflowing it (SheetContent has no built-in width cap of its own,
        unlike Dialog). From sm up, width scales with the viewport instead of
        sitting at one fixed pixel value on every screen.
      */}
      <SheetContent className="w-full sm:w-[min(85vw,32rem)]" aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{drawerTitle}</SheetTitle>
          <SheetClose aria-label={t('common:actions.close', { ns: 'common' })}>
            <X size={18} />
          </SheetClose>
        </SheetHeader>
        <SheetBody>
      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('fields.name')}<RequiredMark /></span>
          <Input
            {...register('name')}
            // The most-opened drawer in the app; it opened with focus on the ✕.
            autoFocus
            aria-required="true"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'client-name-error' : undefined}
          />
          {errors.name && <span id="client-name-error" className="text-xs text-destructive">{t('validation.nameRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('fields.phone')}<RequiredMark /></span>
          <Controller
            name="phone"
            control={control}
            render={({ field }) => (
              <PhoneInput
                value={field.value}
                onChange={field.onChange}
                id="phone"
                aria-label={t('fields.phone')}
                aria-required="true"
                aria-invalid={errors.phone ? true : undefined}
                aria-describedby={errors.phone ? 'client-phone-error' : undefined}
              />
            )}
          />
          {errors.phone && <span id="client-phone-error" className="text-xs text-destructive">{t('validation.phoneRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.email')}
          <Input
            type="email"
            inputMode="email"
            {...register('email')}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'client-email-error' : undefined}
          />
          {errors.email && <span id="client-email-error" className="text-xs text-destructive">{t('validation.emailInvalid')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.notes')}
          <Input {...register('notes')} />
        </label>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('identityDocuments.title')}</span>
          {identityDocuments.fields.map((field, index) => {
            const isDefaultField = isTemplateDocument(field.label)
            const labelError = errors.identityDocuments?.[index]?.label
            return (
            <div key={field.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <div className="w-24 shrink-0">
                <Input
                  {...register(`identityDocuments.${index}.label`)}
                  aria-label={t('identityDocuments.labelFieldAria')}
                  placeholder={t('identityDocuments.labelPlaceholder')}
                  readOnly={isDefaultField}
                  aria-invalid={labelError ? true : undefined}
                  aria-describedby={labelError ? `client-document-${index}-error` : undefined}
                  className={isDefaultField ? 'cursor-default bg-muted text-muted-foreground' : undefined}
                />
              </div>
              <div className="flex-1">
                <Controller
                  name={`identityDocuments.${index}.value`}
                  control={control}
                  render={({ field: valueField }) => (
                    <MaskedTextInput
                      value={valueField.value}
                      onChange={valueField.onChange}
                      mask={getFieldMask(identityDocuments.fields[index].maskKey)}
                      aria-label={t('identityDocuments.valueFieldAria')}
                    />
                  )}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => requestRemoveIdentityDocument(index)}
                aria-label={t('identityDocuments.remove')}
              >
                <X size={16} />
              </Button>
            </div>
            {labelError && (
              <span id={`client-document-${index}-error`} className="text-xs text-destructive">
                {t('validation.documentLabelRequired')}
              </span>
            )}
            </div>
          )})}
          <Button
            type="button"
            variant="secondary"
            onClick={() => identityDocuments.append({ label: '', value: '', maskKey: null })}
          >
            {t('identityDocuments.add')}
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('addressLines.title')}</span>
          {addressLines.fields.map((field, index) => {
            const isDefaultField = isTemplateAddressLine(field.label)
            const labelError = errors.addressLines?.[index]?.label
            return (
            <div key={field.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <div className="w-24 shrink-0">
                <Input
                  {...register(`addressLines.${index}.label`)}
                  aria-label={t('addressLines.labelFieldAria')}
                  placeholder={t('addressLines.labelPlaceholder')}
                  readOnly={isDefaultField}
                  aria-invalid={labelError ? true : undefined}
                  aria-describedby={labelError ? `client-address-${index}-error` : undefined}
                  className={isDefaultField ? 'cursor-default bg-muted text-muted-foreground' : undefined}
                />
              </div>
              <div className="flex-1">
                <Controller
                  name={`addressLines.${index}.value`}
                  control={control}
                  render={({ field: valueField }) =>
                    getFieldMask(field.maskKey) ? (
                      <MaskedTextInput
                        value={valueField.value}
                        onChange={valueField.onChange}
                        mask={getFieldMask(field.maskKey)}
                        aria-label={t('addressLines.valueFieldAria')}
                      />
                    ) : (
                      <AutocompleteInput
                        value={valueField.value}
                        onChange={valueField.onChange}
                        onBlur={valueField.onBlur}
                        suggestions={addressSuggestionsFor(field.label)}
                        aria-label={t('addressLines.valueFieldAria')}
                      />
                    )
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => requestRemoveAddressLine(index)}
                aria-label={t('addressLines.remove')}
              >
                <X size={16} />
              </Button>
            </div>
            {labelError && (
              <span id={`client-address-${index}-error`} className="text-xs text-destructive">
                {t('validation.addressLabelRequired')}
              </span>
            )}
            </div>
          )})}
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              addressLines.append({ label: '', value: '', sortOrder: addressLines.fields.length, maskKey: null })
            }
          >
            {t('addressLines.add')}
          </Button>
        </div>
        <div className="mt-2 flex justify-between gap-2">
          {client && !client.hasAllocationHistory && (
            <Button
              type="button"
              variant="danger"
              onClick={() => setConfirmingDelete(true)}
              disabled={deleteClient.isPending}
            >
              {t('common:actions.delete', { ns: 'common' })}
            </Button>
          )}
          <div className="flex flex-1 justify-end gap-2">
            <Button type="button" variant="secondary" onClick={discardGuard.requestClose}>
              {t('common:actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" disabled={createClient.isPending || updateClient.isPending}>
              {t('common:actions.save', { ns: 'common' })}
            </Button>
          </div>
        </div>
      </form>
      {client && (
        <ConfirmDialog
          open={confirmingDelete}
          title={t('common:confirmDelete.title', { ns: 'common', name: client.name })}
          message={t('common:confirmDelete.message', { ns: 'common' })}
          confirmLabel={t('common:actions.delete', { ns: 'common' })}
          cancelLabel={t('common:actions.cancel', { ns: 'common' })}
          confirmVariant="danger"
          confirmDisabled={deleteClient.isPending}
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
      <ConfirmDialog
        open={confirmingRemoveField !== null}
        title={t('confirmRemoveDefaultField.title', { label: removingFieldLabel })}
        message={t('confirmRemoveDefaultField.message')}
        confirmLabel={t('confirmRemoveDefaultField.confirm')}
        cancelLabel={t('common:actions.cancel', { ns: 'common' })}
        confirmVariant="danger"
        onConfirm={confirmRemoveField}
        onCancel={() => setConfirmingRemoveField(null)}
      />
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
