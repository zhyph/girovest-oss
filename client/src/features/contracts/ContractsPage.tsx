import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { Button } from '../../components/ui/button.tsx'
import { cn } from '../../lib/cn.ts'
import { Input } from '../../components/ui/input.tsx'
import { CurrencyInput } from '../../components/ui/currency-input.tsx'
import { Modal } from '../../components/ui/modal.tsx'
import { ConfirmDialog } from '../../components/ui/confirm-dialog.tsx'
import { parseDateOnly, formatDate } from '../../lib/date.ts'
import { formatCurrency, getLocaleConfig } from '../../lib/locale.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { useUnsavedChangesGuard } from '../../lib/useUnsavedChangesGuard.ts'
import { useSectionTour } from '../onboarding/useSectionTour.ts'
import { useClients } from '../clients/useClients.ts'
import { useProducts } from '../products/useProducts.ts'
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
        <Modal open={showCheckOutDialog} onClose={checkOutGuard.requestClose} title={t('checkOutDialog.title')}>
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
        </Modal>
        <Modal open={showEarlyConfirm} onClose={() => setShowEarlyConfirm(false)} title={t('checkOutDialog.earlyTitle')}>
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
        </Modal>
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
        <Modal open={showReturnDialog} onClose={returnGuard.requestClose} title={t('returnDialog.title')}>
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
        </Modal>
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

  const contracts = data?.contracts
  const pageSize = data?.pageSize ?? 20
  const currentPage = data?.page ?? page
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))

  function handleSearchChange(value: string) {
    setSearch(value)
    setPage(1)
  }

  if (isLoading) return <div>{t('title')}</div>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex flex-shrink-0 items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button onClick={() => setShowForm(true)} data-tour="contracts.create">
          {t('newContract')}
        </Button>
      </div>
      {(search || (data?.total ?? 0) > 0) && (
        <Input
          value={search}
          onChange={(event) => handleSearchChange(event.target.value)}
          placeholder={t('searchPlaceholder')}
          className="mb-3 flex-shrink-0"
          aria-label={t('searchPlaceholder')}
          data-tour="contracts.search"
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {contracts && contracts.length === 0 && (
          <p className="text-muted-foreground">{search ? t('noResults') : t('empty')}</p>
        )}
        <div className="flex flex-col gap-3">
          {contracts?.map((contract, index) => (
            <div
              key={contract.id}
              className="rounded-md border border-border p-3"
              data-tour={index === 0 ? 'contracts.card' : undefined}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="font-medium">
                    #{contract.number} — <span>{clientNames.get(contract.clientId) ?? contract.clientId}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(parseDateOnly(contract.eventDate), locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    to={`/contratos/${contract.id}/imprimir`}
                    className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:border-ring hover:bg-secondary"
                  >
                    {t('print.action')}
                  </Link>
                  <ContractSignAction contract={contract} />
                  <ContractCancelAction contract={contract} />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                {contract.allocations.map((allocation) => (
                  <div
                    key={allocation.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border p-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-medium">
                        {productNames.get(allocation.productId) ?? allocation.productId}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(parseDateOnly(allocation.checkoutDate), locale, { day: '2-digit', month: '2-digit', year: 'numeric' })} –{' '}
                        {formatDate(parseDateOnly(allocation.dueDate), locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </span>
                    </div>
                    <div className="shrink-0">
                      <RowActions allocation={allocation} />
                    </div>
                  </div>
                ))}
              </div>
              <ContractPayments contract={contract} />
            </div>
          ))}
        </div>
      </div>
      {totalPages > 1 && (
        <div className="flex flex-shrink-0 items-center justify-between text-sm" data-tour="contracts.pagination">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            {t('pagination.previous')}
          </Button>
          <span className="text-muted-foreground">
            {t('pagination.pageOf', { page: currentPage, total: totalPages })}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            {t('pagination.next')}
          </Button>
        </div>
      )}
      {showForm && <NewContractForm onClose={() => setShowForm(false)} />}
    </div>
  )
}
