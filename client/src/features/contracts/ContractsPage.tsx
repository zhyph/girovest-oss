import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { Button } from '../../components/ui/button.tsx'
import { cn } from '../../lib/cn.ts'
import { Input } from '../../components/ui/input.tsx'
import { CurrencyInput } from '../../components/ui/currency-input.tsx'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog.tsx'
import { Toolbar, ToolbarSearch, ScreenTitle, SectionLabel } from '../../components/ui/toolbar.tsx'
import { DataList, DataListEmpty, type DataListColumn } from '../../components/ui/data-list.tsx'
import { StatusBadge, type EntityState } from '../../components/ui/status-badge.tsx'
import { AuthenticatedPhoto } from '../../components/ui/authenticated-photo.tsx'
import { formatCurrency, getLocaleConfig } from '../../lib/locale.ts'
import { ConfirmDialog } from '../../components/ui/confirm-dialog.tsx'
import { parseDateOnly, formatDate } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { useUnsavedChangesGuard } from '../../lib/useUnsavedChangesGuard.ts'
import { useSectionTour } from '../onboarding/useSectionTour.ts'
import { useClients } from '../clients/useClients.ts'
import { useProducts } from '../products/useProducts.ts'
import type { Product } from '../products/productSchemas.ts'
import {
  useCheckOutAllocation,
  useReturnAllocation,
  useCancelAllocation,
} from '../allocations/useAllocations.ts'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import { useContractsList, useCancelContract, useSetInstallmentPaid, CONTRACTS_KEY } from './useContracts.ts'
import type { Contract } from './contractSchemas.ts'
import { NewContractForm } from './NewContractForm.tsx'
import { SignRemotelyModal } from './SignRemotelyModal.tsx'

/**
 * A contract's single visible state, derived from its pieces. The list
 * previously showed no state at all at contract level — you had to open a
 * card and read its allocations to know whether anything was overdue.
 * Precedence is worst-first: one late piece makes the contract late.
 */
export function contractState(contract: Contract, today = new Date()): EntityState {
  const live = contract.allocations.filter((allocation) => allocation.status !== 'cancelled')
  if (live.length === 0) return 'cancelled'
  const isLate = (allocation: (typeof live)[number]) =>
    allocation.status === 'checked_out' && parseDateOnly(allocation.dueDate) < today
  if (live.some(isLate)) return 'overdue'
  if (live.some((allocation) => allocation.status === 'checked_out')) return 'checked_out'
  if (live.every((allocation) => allocation.status === 'returned')) return 'returned'
  return 'reserved'
}

function contractTotal(contract: Contract): number {
  return contract.allocations
    .filter((allocation) => allocation.status !== 'cancelled')
    .reduce((sum, allocation) => sum + allocation.priceCharged, 0)
}

function resolveErrorCode(error: unknown): string {
  return (error as { code?: string })?.code ?? 'UNKNOWN'
}

export function RowActions({ allocation }: { allocation: Allocation }) {
  const { t } = useTranslation('allocations')
  const checkOut = useCheckOutAllocation()
  const returnAllocation = useReturnAllocation()
  const cancel = useCancelAllocation()
  const { locale } = useLocale()
  const [showCheckOutDialog, setShowCheckOutDialog] = useState(false)
  const [showEarlyConfirm, setShowEarlyConfirm] = useState(false)
  const [showReturnDialog, setShowReturnDialog] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [conditionNotesOut, setConditionNotesOut] = useState('')
  const [depositCollected, setDepositCollected] = useState(0)
  const [conditionNotesIn, setConditionNotesIn] = useState('')
  const [depositReturned, setDepositReturned] = useState(0)

  // These dialogs hold their input in plain state, so closing them has to clear
  // it explicitly — otherwise reopening shows whatever was typed last time.
  function closeCheckOutDialog() {
    setShowCheckOutDialog(false)
    setConditionNotesOut('')
    setDepositCollected(0)
  }

  function closeReturnDialog() {
    setShowReturnDialog(false)
    setConditionNotesIn('')
    setDepositReturned(0)
  }

  const checkOutGuard = useUnsavedChangesGuard({
    isDirty: conditionNotesOut.trim() !== '' || depositCollected !== 0,
    onConfirmDiscard: closeCheckOutDialog,
  })
  const returnGuard = useUnsavedChangesGuard({
    isDirty: conditionNotesIn.trim() !== '' || depositReturned !== 0,
    onConfirmDiscard: closeReturnDialog,
  })

  function showActionError(error: unknown) {
    const code = resolveErrorCode(error)
    showErrorToast(t(`errors.${code}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) }))
  }

  async function handleCheckOut() {
    try {
      await checkOut.mutateAsync({ id: allocation.id, conditionNotesOut, depositCollected })
      closeCheckOutDialog()
    } catch (error) {
      // Being early is a decision for the shop to make, not a dead end — ask
      // instead of toasting. The server clock stays the only authority on
      // what counts as early, so this is driven by its answer.
      if (resolveErrorCode(error) === 'CHECKOUT_TOO_EARLY') {
        setShowEarlyConfirm(true)
        return
      }
      showActionError(error)
    }
  }

  async function handleConfirmEarlyCheckOut() {
    try {
      await checkOut.mutateAsync({ id: allocation.id, conditionNotesOut, depositCollected, allowEarly: true })
      setShowEarlyConfirm(false)
      closeCheckOutDialog()
    } catch (error) {
      setShowEarlyConfirm(false)
      showActionError(error)
    }
  }

  async function handleReturn() {
    try {
      await returnAllocation.mutateAsync({ id: allocation.id, conditionNotesIn, depositReturned })
      closeReturnDialog()
    } catch (error) {
      showActionError(error)
    }
  }

  async function handleCancel() {
    try {
      await cancel.mutateAsync(allocation.id)
      setShowCancelConfirm(false)
    } catch (error) {
      showActionError(error)
    }
  }

  if (allocation.status === 'reserved') {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setShowCheckOutDialog(true)} disabled={checkOut.isPending}>
            {t('actions.checkOut')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setShowCancelConfirm(true)} disabled={cancel.isPending}>
            {t('actions.cancel')}
          </Button>
        </div>
        <Dialog
          open={showCheckOutDialog}
          onOpenChange={(nextOpen) => !nextOpen && checkOutGuard.requestClose()}
        >
          <DialogContent showCloseButton={false} className="max-w-sm gap-0 p-5">
            <DialogTitle className="mb-3 text-heading">{t('checkOutDialog.title')}</DialogTitle>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t('fields.conditionNotesOut')}
              <Input value={conditionNotesOut} onChange={(event) => setConditionNotesOut(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('fields.depositCollected')}
              <CurrencyInput value={depositCollected} onChange={setDepositCollected} aria-label={t('fields.depositCollected')} />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={checkOutGuard.requestClose}>
                {t('common:actions.cancel', { ns: 'common' })}
              </Button>
              <Button type="button" onClick={handleCheckOut} disabled={checkOut.isPending}>
                {t('checkOutDialog.confirm')}
              </Button>
            </div>
            <ConfirmDialog
              open={checkOutGuard.isConfirmingDiscard}
              title={t('common:confirmDiscard.title', { ns: 'common' })}
              message={t('common:confirmDiscard.message', { ns: 'common' })}
              confirmLabel={t('common:confirmDiscard.confirm', { ns: 'common' })}
              cancelLabel={t('common:confirmDiscard.cancel', { ns: 'common' })}
              confirmVariant="danger"
              onConfirm={checkOutGuard.confirmDiscard}
              onCancel={checkOutGuard.cancelDiscard}
            />
          </div>
          </DialogContent>
        </Dialog>
        <Dialog open={showEarlyConfirm} onOpenChange={(nextOpen) => !nextOpen && setShowEarlyConfirm(false)}>
          <DialogContent showCloseButton={false} className="max-w-sm gap-0 p-5">
            <DialogTitle className="mb-3 text-heading">{t('checkOutDialog.earlyTitle')}</DialogTitle>
          <p className="mb-4 text-sm text-foreground">
            {t('checkOutDialog.earlyMessage', {
              date: formatDate(parseDateOnly(allocation.checkoutDate), locale, {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              }),
            })}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setShowEarlyConfirm(false)}>
              {t('common:actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="button" onClick={handleConfirmEarlyCheckOut} disabled={checkOut.isPending}>
              {t('checkOutDialog.earlyConfirm')}
            </Button>
          </div>
          </DialogContent>
        </Dialog>
        <ConfirmDialog
          open={showCancelConfirm}
          title={t('common:confirmCancelAllocation.title', { ns: 'common' })}
          message={t('common:confirmCancelAllocation.message', { ns: 'common' })}
          confirmLabel={t('common:confirmCancelAllocation.confirm', { ns: 'common' })}
          cancelLabel={t('common:actions.cancel', { ns: 'common' })}
          confirmDisabled={cancel.isPending}
          onConfirm={handleCancel}
          onCancel={() => setShowCancelConfirm(false)}
        />
      </div>
    )
  }
  if (allocation.status === 'checked_out') {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button size="sm" onClick={() => setShowReturnDialog(true)} disabled={returnAllocation.isPending}>
          {t('actions.return')}
        </Button>
        <Dialog open={showReturnDialog} onOpenChange={(nextOpen) => !nextOpen && returnGuard.requestClose()}>
          <DialogContent showCloseButton={false} className="max-w-sm gap-0 p-5">
            <DialogTitle className="mb-3 text-heading">{t('returnDialog.title')}</DialogTitle>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t('fields.conditionNotesIn')}
              <Input value={conditionNotesIn} onChange={(event) => setConditionNotesIn(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('fields.depositReturned')}
              <CurrencyInput value={depositReturned} onChange={setDepositReturned} aria-label={t('fields.depositReturned')} />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={returnGuard.requestClose}>
                {t('common:actions.cancel', { ns: 'common' })}
              </Button>
              <Button type="button" onClick={handleReturn} disabled={returnAllocation.isPending}>
                {t('returnDialog.confirm')}
              </Button>
            </div>
            <ConfirmDialog
              open={returnGuard.isConfirmingDiscard}
              title={t('common:confirmDiscard.title', { ns: 'common' })}
              message={t('common:confirmDiscard.message', { ns: 'common' })}
              confirmLabel={t('common:confirmDiscard.confirm', { ns: 'common' })}
              cancelLabel={t('common:confirmDiscard.cancel', { ns: 'common' })}
              confirmVariant="danger"
              onConfirm={returnGuard.confirmDiscard}
              onCancel={returnGuard.cancelDiscard}
            />
          </div>
          </DialogContent>
        </Dialog>
      </div>
    )
  }
  return null
}

const SHORT_DATE: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }

function ContractPayments({ contract }: { contract: Contract }) {
  const { t } = useTranslation('contracts')
  const { locale } = useLocale()
  const currency = getLocaleConfig(locale).currency
  const setPaid = useSetInstallmentPaid()
  // Collapsed by default: a contract paid in 12 instalments would otherwise
  // push every other contract off the screen. The money summary — the part
  // worth scanning down the list — stays visible either way.
  const [isExpanded, setIsExpanded] = useState(false)
  const listId = useId()

  // The contract is worth what its pieces were charged at; installments are
  // just how the client agreed to pay it. They do not always add up to the
  // same number, so the outstanding balance is measured against the pieces.
  const total = contract.allocations.reduce((sum, allocation) => sum + allocation.priceCharged, 0)
  const paid = contract.installments.reduce(
    (sum, installment) => (installment.paid ? sum + installment.amount : sum),
    0,
  )
  const outstanding = total - paid
  const paidCount = contract.installments.filter((installment) => installment.paid).length

  async function toggle(installmentId: string, paidNow: boolean) {
    try {
      await setPaid.mutateAsync({ contractId: contract.id, installmentId, paid: paidNow })
    } catch (error) {
      showErrorToast(
        t(`errors.${resolveErrorCode(error)}`, { defaultValue: t('errors.INSTALLMENT_UPDATE_FAILED') }),
      )
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {contract.installments.length > 0 ? (
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-controls={listId}
            onClick={() => setIsExpanded((open) => !open)}
            className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <ChevronRight size={12} className={cn('transition-transform', isExpanded && 'rotate-90')} />
            {t('payments.title')}
            <span className="font-normal text-muted-foreground">
              {t('payments.paidCount', { paid: paidCount, total: contract.installments.length })}
            </span>
          </button>
        ) : (
          <span className="font-medium">{t('payments.title')}</span>
        )}
        <span className="text-muted-foreground">
          {t('payments.total')}: {formatCurrency(total, locale, currency)}
        </span>
        <span className="text-muted-foreground">
          {t('payments.paid')}: {formatCurrency(paid, locale, currency)}
        </span>
        <span className={outstanding > 0 ? 'font-medium text-warning-foreground' : 'text-muted-foreground'}>
          {t('payments.outstanding')}: {formatCurrency(outstanding, locale, currency)}
        </span>
      </div>
      {contract.installments.length === 0 ? (
        <span className="text-xs text-muted-foreground">{t('payments.none')}</span>
      ) : (
        isExpanded && (
        <ul id={listId} className="flex flex-col gap-1">
          {contract.installments.map((installment) => (
            <li key={installment.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span>{formatDate(parseDateOnly(installment.dueDate), locale, SHORT_DATE)}</span>
                <span className="font-medium">{formatCurrency(installment.amount, locale, currency)}</span>
                {installment.paid && installment.paidAt && (
                  <span className="text-muted-foreground">
                    {t('payments.paidOn', {
                      date: formatDate(new Date(installment.paidAt), locale, SHORT_DATE),
                    })}
                  </span>
                )}
              </span>
              <Button
                type="button"
                size="sm"
                variant={installment.paid ? 'ghost' : 'secondary'}
                disabled={setPaid.isPending}
                onClick={() => toggle(installment.id, !installment.paid)}
              >
                {installment.paid ? t('payments.markUnpaid') : t('payments.markPaid')}
              </Button>
            </li>
          ))}
        </ul>
        )
      )}
    </div>
  )
}

function ContractCancelAction({ contract }: { contract: Contract }) {
  const { t } = useTranslation('contracts')
  const cancelContract = useCancelContract()
  const [showConfirm, setShowConfirm] = useState(false)

  const hasReservedAllocation = contract.allocations.some((allocation) => allocation.status === 'reserved')
  if (!hasReservedAllocation) return null

  async function handleCancel() {
    try {
      await cancelContract.mutateAsync(contract.id)
      setShowConfirm(false)
    } catch (error) {
      showErrorToast(t(`errors.${resolveErrorCode(error)}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) }))
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setShowConfirm(true)}
        disabled={cancelContract.isPending}
      >
        {t('cancelContract.action')}
      </Button>
      <ConfirmDialog
        open={showConfirm}
        title={t('cancelContract.confirmTitle')}
        message={t('cancelContract.confirmMessage')}
        confirmLabel={t('cancelContract.confirm')}
        cancelLabel={t('common:actions.cancel', { ns: 'common' })}
        confirmDisabled={cancelContract.isPending}
        onConfirm={handleCancel}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  )
}

function ContractSignAction({ contract }: { contract: Contract }) {
  const { t } = useTranslation('contracts')
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)

  if (contract.signatureStatus === 'signed') return null

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setShowModal(true)}>
        {t('sign.action')}
      </Button>
      <SignRemotelyModal
        contractId={contract.id}
        open={showModal}
        onClose={() => {
          setShowModal(false)
          // Tail case: a signature completed moments before closing, before
          // the modal's own poll-triggered invalidation would have fired.
          void queryClient.invalidateQueries({ queryKey: CONTRACTS_KEY })
        }}
      />
    </>
  )
}

/**
 * The contract, read rather than operated. The list used to render every
 * contract as a card carrying Imprimir, Assinar and Cancelar in its header,
 * Check-out and Cancelar on each piece, and Marcar como pago on each
 * instalment — a three-piece contract with six instalments put sixteen
 * buttons on screen at once, all competing. Only the selected contract
 * shows its actions now, and the per-piece ones live in the row's own menu.
 */
function ContractDetailPanel({
  contract,
  clientName,
  productNames,
  products,
}: {
  contract: Contract | null
  clientName: string
  productNames: Map<string, string>
  products: Map<string, Product>
}) {
  const { t } = useTranslation('contracts')
  const { locale } = useLocale()
  const currency = getLocaleConfig(locale).currency

  if (!contract) {
    return (
      <div className="p-5">
        <p className="text-meta text-muted-foreground">{t('detail.pickContract')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/*
        Identity above, actions below. Side by side, three full-width
        actions (Imprimir, Assinar remotamente, Cancelar contrato) left the
        520px panel nothing for the client's name, which collapsed into a
        three-line sliver — only visible once a contract had all three.
      */}
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-foreground-subtle">#{contract.number}</span>
            <StatusBadge state={contractState(contract)} />
          </div>
          <span className="text-heading">{clientName}</span>
          <span className="text-meta text-muted-foreground">
            {t('fields.eventDate')}{' '}
            {formatDate(parseDateOnly(contract.eventDate), locale, {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            to={`/contratos/${contract.id}/imprimir`}
            className="inline-flex h-7.5 items-center justify-center rounded-control border border-border-strong bg-surface px-3 text-[13px] font-medium text-foreground hover:bg-surface-sunken"
          >
            {t('print.action')}
          </Link>
          <ContractSignAction contract={contract} />
          <ContractCancelAction contract={contract} />
        </div>
      </div>

      <div className="flex flex-col gap-2.5 border-b border-border px-5 py-4">
        <SectionLabel>{t('items.title')}</SectionLabel>
        <div className="overflow-hidden rounded-panel border border-border">
          {contract.allocations.map((allocation) => {
            const photo = products.get(allocation.productId)?.photos?.[0]
            return (
              <div
                key={allocation.id}
                className="grid grid-cols-[56px_1fr_88px_28px] items-center gap-3 border-b border-hairline bg-card p-2.5 last:border-b-0"
              >
                {photo ? (
                  <AuthenticatedPhoto
                    url={photo}
                    alt=""
                    className="size-14 rounded-badge border border-border object-cover"
                  />
                ) : (
                  <span className="size-14 rounded-badge border border-border bg-surface-sunken" />
                )}
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13.5px] font-semibold">
                    {productNames.get(allocation.productId) ?? allocation.productId}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(parseDateOnly(allocation.checkoutDate), locale, { day: '2-digit', month: '2-digit' })} –{' '}
                    {formatDate(parseDateOnly(allocation.dueDate), locale, { day: '2-digit', month: '2-digit' })}
                  </span>
                  <span>
                    <StatusBadge state={allocation.status as EntityState} />
                  </span>
                </span>
                <span className="tabular text-right text-[13.5px]">
                  {formatCurrency(allocation.priceCharged, locale, currency)}
                </span>
                <RowActions allocation={allocation} />
              </div>
            )
          })}
          <div className="flex items-center justify-between gap-3 bg-surface-sunken px-3 py-2.5">
            <span className="text-meta text-muted-foreground">{t('items.total')}</span>
            <span className="tabular text-body font-semibold">
              {formatCurrency(contractTotal(contract), locale, currency)}
            </span>
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        <ContractPayments contract={contract} />
      </div>
    </div>
  )
}

export function ContractsPage() {
  const { t } = useTranslation('contracts')
  const { locale } = useLocale()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const { data, isLoading } = useContractsList({ page, search })
  const { data: products } = useProducts()
  const { data: clients } = useClients()
  // `?novo=1` is how the rail's "Nova alocação" shortcut opens this form
  // from anywhere in the app. The param is the single source of truth
  // while the form is up, so closing it (or navigating back) clears the
  // URL too and a refresh doesn't silently reopen the form.
  const [searchParams, setSearchParams] = useSearchParams()
  const showForm = searchParams.get('novo') === '1'
  const setShowForm = (open: boolean) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (open) next.set('novo', '1')
        else next.delete('novo')
        return next
      },
      { replace: true },
    )
  }
  useSectionTour('contracts', !isLoading)

  const productNames = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product.name])),
    [products],
  )
  const clientNames = useMemo(
    () => new Map((clients ?? []).map((client) => [client.id, client.name])),
    [clients],
  )
  const productsById = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product])),
    [products],
  )
  const currency = getLocaleConfig(locale).currency
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const contracts = data?.contracts
  const pageSize = data?.pageSize ?? 20
  const currentPage = data?.page ?? page
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))

  function handleSearchChange(value: string) {
    setSearch(value)
    setPage(1)
  }

  if (isLoading) return <div>{t('title')}</div>

  const columns: DataListColumn<Contract>[] = [
    {
      key: 'number',
      header: t('columns.number'),
      width: '64px',
      cell: (contract) => <span className="font-mono text-xs text-foreground-subtle">#{contract.number}</span>,
    },
    {
      key: 'pieces',
      header: t('columns.pieces'),
      width: '112px',
      cell: (contract) => (
        // Stacked thumbnails: the point is to recognise what is out on a
        // contract without opening it.
        <span className="flex items-center">
          {contract.allocations.slice(0, 3).map((allocation, index) => {
            const photo = productsById.get(allocation.productId)?.photos?.[0]
            return photo ? (
              <AuthenticatedPhoto
                key={allocation.id}
                url={photo}
                alt=""
                className="size-7 rounded-badge border-2 border-surface object-cover"
                {...(index > 0 ? { style: { marginLeft: -8 } } : {})}
              />
            ) : (
              <span
                key={allocation.id}
                className="size-7 rounded-badge border-2 border-surface bg-surface-sunken"
                style={index > 0 ? { marginLeft: -8 } : undefined}
              />
            )
          })}
          {contract.allocations.length > 3 && (
            <span
              className="inline-flex size-7 items-center justify-center rounded-badge border-2 border-surface bg-border font-mono text-[10px] text-muted-foreground"
              style={{ marginLeft: -8 }}
            >
              +{contract.allocations.length - 3}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'client',
      header: t('columns.client'),
      width: '1.5fr',
      cell: (contract) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body font-semibold">
            {clientNames.get(contract.clientId) ?? contract.clientId}
          </span>
          <span className="truncate text-xs text-foreground-subtle">
            {formatDate(parseDateOnly(contract.eventDate), locale, {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })}
          </span>
        </span>
      ),
    },
    {
      key: 'state',
      header: t('columns.state'),
      width: '1fr',
      cell: (contract) => <StatusBadge state={contractState(contract)} />,
    },
    {
      key: 'value',
      header: t('columns.value'),
      width: '108px',
      align: 'right',
      cell: (contract) => (
        <span className="tabular text-body">{formatCurrency(contractTotal(contract), locale, currency)}</span>
      ),
    },
  ]

  const selected = contracts?.find((contract) => contract.id === selectedId) ?? null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScreenTitle>{t('title')}</ScreenTitle>
      <Toolbar
        search={
          <ToolbarSearch
            value={search}
            onChange={handleSearchChange}
            placeholder={t('searchPlaceholder')}
            label={t('searchPlaceholder')}
            dataTour="contracts.search"
          />
        }
        actions={
          <Button onClick={() => setShowForm(true)} data-tour="contracts.create">
            {t('newContract')}
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 border-t border-border-strong" data-tour="contracts.card">
        <DataList
          columns={columns}
          groups={[{ key: 'all', label: undefined, rows: contracts ?? [] }]}
          rowKey={(contract) => contract.id}
          onSelectRow={(contract) => setSelectedId(contract.id)}
          selectedKey={selectedId}
          empty={<DataListEmpty title={search ? t('noResults') : t('empty')} />}
          pagination={
            totalPages > 1
              ? {
                  label: t('pagination.pageOf', { page: currentPage, total: totalPages }),
                  onPrevious: () => setPage(currentPage - 1),
                  onNext: () => setPage(currentPage + 1),
                  hasPrevious: currentPage > 1,
                  hasNext: currentPage < totalPages,
                  dataTour: 'contracts.pagination',
                }
              : undefined
          }
        />

        <aside className="min-h-0 w-130 flex-shrink-0 overflow-y-auto border-l border-border-strong">
          <ContractDetailPanel
            contract={selected}
            clientName={selected ? (clientNames.get(selected.clientId) ?? selected.clientId) : ''}
            productNames={productNames}
            products={productsById}
          />
        </aside>
      </div>
      {showForm && <NewContractForm onClose={() => setShowForm(false)} />}
    </div>
  )
}
