import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { startOfWeek, endOfWeek } from 'date-fns'
import { Button } from '../../components/ui/button.tsx'
import { cn } from '../../lib/cn.ts'
import { Input } from '../../components/ui/input.tsx'
import { CurrencyInput } from '../../components/ui/currency-input.tsx'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog.tsx'
import { Toolbar, ToolbarSearch, ScreenTitle, SectionLabel, FilterChip } from '../../components/ui/toolbar.tsx'
import { RowActions, DropdownMenuItem } from '../../components/ui/dropdown-menu.tsx'
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
import type { Client } from '../clients/clientSchemas.ts'
import { useProducts } from '../products/useProducts.ts'
import type { Product } from '../products/productSchemas.ts'
import {
  useCheckOutAllocation,
  useReturnAllocation,
  useCancelAllocation,
} from '../allocations/useAllocations.ts'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import {
  useContractsList,
  useCancelContract,
  useSetInstallmentPaid,
  CONTRACTS_KEY,
  type ContractStatusFilter,
} from './useContracts.ts'
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

export type ContractWeekGroup = 'thisWeek' | 'upcoming' | 'past'

/**
 * Grouped by the EVENT date, not by when the contract was written: the shop
 * plans around the day the dress is needed, and a contract sold in March for
 * a December wedding belongs with December.
 */
export function contractWeekGroup(contract: Contract, today: Date): ContractWeekGroup {
  const event = parseDateOnly(contract.eventDate)
  if (event < startOfWeek(today, { weekStartsOn: 0 })) return 'past'
  if (event > endOfWeek(today, { weekStartsOn: 0 })) return 'upcoming'
  return 'thisWeek'
}

const WEEK_GROUP_ORDER: ContractWeekGroup[] = ['thisWeek', 'upcoming', 'past']

/**
 * What the contract is worth today: its pieces' charged prices, minus the ones
 * that were cancelled.
 *
 * The single definition of a contract's total — the row's figure and the
 * detail panel's money tiles both come through here. They disagreed once, and
 * a contract showed two different Totals depending on where you looked; worse,
 * the higher of the two counted cancelled pieces, so the outstanding balance
 * told the shop to chase a client for a dress it never sent out.
 */
export function contractTotal(contract: Contract): number {
  return contract.allocations
    .filter((allocation) => allocation.status !== 'cancelled')
    .reduce((sum, allocation) => sum + allocation.priceCharged, 0)
}

function resolveErrorCode(error: unknown): string {
  return (error as { code?: string })?.code ?? 'UNKNOWN'
}

export function AllocationActions({ allocation }: { allocation: Allocation }) {
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
        {/*
          The dialogs stay siblings of the menu rather than children of it:
          Radix unmounts the menu content on select, which would tear down any
          dialog rendered inside it before it ever painted.
        */}
        <RowActions label={t('actions.more')}>
          <DropdownMenuItem disabled={checkOut.isPending} onSelect={() => setShowCheckOutDialog(true)}>
            {t('actions.checkOut')}
          </DropdownMenuItem>
          <DropdownMenuItem destructive disabled={cancel.isPending} onSelect={() => setShowCancelConfirm(true)}>
            {t('actions.cancel')}
          </DropdownMenuItem>
        </RowActions>
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
        <RowActions label={t('actions.more')}>
          <DropdownMenuItem disabled={returnAllocation.isPending} onSelect={() => setShowReturnDialog(true)}>
            {t('actions.return')}
          </DropdownMenuItem>
        </RowActions>
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

  // The contract is worth what its live pieces were charged at; installments
  // are just how the client agreed to pay it. They do not always add up to the
  // same number, so the outstanding balance is measured against the pieces.
  const total = contractTotal(contract)
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
    <div className="flex flex-col gap-2.5">
      {contract.installments.length > 0 ? (
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={listId}
          onClick={() => setIsExpanded((open) => !open)}
          className="-ml-1 inline-flex w-fit items-center gap-1 rounded px-1 py-0.5 text-label text-foreground-subtle uppercase transition-colors hover:bg-secondary"
        >
          <ChevronRight size={12} className={cn('transition-transform', isExpanded && 'rotate-90')} />
          {t('payments.title')}
          <span className="tabular normal-case">
            {t('payments.paidCount', { paid: paidCount, total: contract.installments.length })}
          </span>
        </button>
      ) : (
        <SectionLabel>{t('payments.title')}</SectionLabel>
      )}
      {/*
        Three cells rather than one run-on line. The money is the question
        this panel is opened to answer, and "Total: X Pago: Y Em aberto: Z"
        wrapped as prose gave the outstanding balance no more weight than the
        word next to it. Same tile anatomy as the Painel's counters, so a
        figure reads the same way wherever it appears.
      */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { key: 'total', label: t('payments.total'), value: total, urgent: false },
          { key: 'paid', label: t('payments.paid'), value: paid, urgent: false },
          { key: 'outstanding', label: t('payments.outstanding'), value: outstanding, urgent: outstanding > 0 },
        ].map((cell) => (
          <div
            key={cell.key}
            className={cn(
              'flex flex-col gap-1 rounded-panel border px-3 py-2.5',
              cell.urgent ? 'border-warning-border bg-warning' : 'border-border bg-card',
            )}
          >
            <span
              className={cn(
                'text-label uppercase',
                cell.urgent ? 'text-warning-foreground' : 'text-foreground-subtle',
              )}
            >
              {cell.label}
            </span>
            <span
              className={cn(
                'tabular text-body font-semibold',
                cell.urgent ? 'text-warning-foreground' : 'text-foreground',
              )}
            >
              {formatCurrency(cell.value, locale, currency)}
            </span>
          </div>
        ))}
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

/**
 * Imprimir stays a visible button; the other two hide behind the overflow.
 * Printing is what this panel is opened for several times a day, while
 * signing happens once per contract and cancelling ideally never — three
 * equal-weight buttons made the rare destructive one as easy to hit as the
 * routine one.
 */
function ContractHeaderActions({ contract }: { contract: Contract }) {
  const { t } = useTranslation('contracts')
  const queryClient = useQueryClient()
  const cancelContract = useCancelContract()
  const [showSignModal, setShowSignModal] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  const canSign = contract.signatureStatus !== 'signed'
  const canCancel = contract.allocations.some((allocation) => allocation.status === 'reserved')

  async function handleCancel() {
    try {
      await cancelContract.mutateAsync(contract.id)
      setShowCancelConfirm(false)
    } catch (error) {
      showErrorToast(
        t(`errors.${resolveErrorCode(error)}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) }),
      )
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Link
        to={`/contratos/${contract.id}/imprimir`}
        className="inline-flex h-7.5 items-center justify-center rounded-control border border-border-strong bg-surface px-3 text-[13px] font-medium text-foreground hover:bg-surface-sunken"
      >
        {t('print.action')}
      </Link>
      {/*
        A signed contract with nothing left reserved has neither action, and
        an empty menu is worse than no menu.
      */}
      {(canSign || canCancel) && (
        <RowActions label={t('detail.moreActions')}>
          {canSign && (
            <DropdownMenuItem onSelect={() => setShowSignModal(true)}>{t('sign.action')}</DropdownMenuItem>
          )}
          {canCancel && (
            <DropdownMenuItem
              destructive
              disabled={cancelContract.isPending}
              onSelect={() => setShowCancelConfirm(true)}
            >
              {t('cancelContract.action')}
            </DropdownMenuItem>
          )}
        </RowActions>
      )}
      <SignRemotelyModal
        contractId={contract.id}
        open={showSignModal}
        onClose={() => {
          setShowSignModal(false)
          // Tail case: a signature completed moments before closing, before
          // the modal's own poll-triggered invalidation would have fired.
          void queryClient.invalidateQueries({ queryKey: CONTRACTS_KEY })
        }}
      />
      <ConfirmDialog
        open={showCancelConfirm}
        title={t('cancelContract.confirmTitle')}
        message={t('cancelContract.confirmMessage')}
        confirmLabel={t('cancelContract.confirm')}
        cancelLabel={t('common:actions.cancel', { ns: 'common' })}
        confirmDisabled={cancelContract.isPending}
        onConfirm={handleCancel}
        onCancel={() => setShowCancelConfirm(false)}
      />
    </div>
  )
}

/**
 * Who the contract is with, in the detail panel rather than only on the
 * printed sheet. The documents and address are exactly what staff are asked
 * for on the phone ("qual o CPF dela?"), and reaching them meant leaving for
 * the Clientes screen and finding the person again.
 */
function ContractClientSection({ client }: { client: Client | undefined }) {
  const { t } = useTranslation('contracts')
  if (!client) return null

  const documents = client.identityDocuments.filter((document) => document.value.trim() !== '')
  const addressLines = [...client.addressLines]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((line) => line.value.trim() !== '')

  return (
    <div className="flex flex-col gap-2.5 border-b border-border px-5 py-4">
      <SectionLabel>{t('detail.client.title')}</SectionLabel>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-meta text-muted-foreground">{t('detail.client.documents')}</dt>
          {documents.length === 0 ? (
            <dd className="text-meta text-foreground-subtle">{t('detail.client.none')}</dd>
          ) : (
            documents.map((document) => (
              <dd key={document.id} className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
                <span className="flex-shrink-0 text-foreground-subtle">{document.label}</span>
                <span className="truncate">{document.value}</span>
              </dd>
            ))
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-meta text-muted-foreground">{t('detail.client.address')}</dt>
          {addressLines.length === 0 ? (
            <dd className="text-meta text-foreground-subtle">{t('detail.client.none')}</dd>
          ) : (
            addressLines.map((line) => (
              <dd key={line.id} className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
                <span className="flex-shrink-0 text-foreground-subtle">{line.label}</span>
                <span className="truncate">{line.value}</span>
              </dd>
            ))
          )}
        </div>
      </dl>
    </div>
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
  client,
  clientName,
  productNames,
  products,
}: {
  contract: Contract | null
  client: Client | undefined
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
        <ContractHeaderActions contract={contract} />
      </div>

      <ContractClientSection client={client} />

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
                <AllocationActions allocation={allocation} />
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
  const [filter, setFilter] = useState<ContractStatusFilter>('all')
  const { data, isLoading } = useContractsList({ page, search, status: filter })
  const { data: products } = useProducts()
  const { data: clients } = useClients()
  // `?novo=1` is how the rail's "Nova alocação" shortcut opens this form
  // from anywhere in the app. The param is the single source of truth
  // while the form is up, so closing it (or navigating back) clears the
  // URL too and a refresh doesn't silently reopen the form.
  const [searchParams, setSearchParams] = useSearchParams()
  const showForm = searchParams.get('novo') === '1'
  // Set by the Clientes screen's own "Novo contrato" shortcut, which knows
  // who the contract is for. Cleared with `novo` so a stale id cannot outlive
  // the dialog that used it.
  const presetClientId = searchParams.get('clienteId') ?? undefined
  const setShowForm = (open: boolean) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (open) {
          next.set('novo', '1')
        } else {
          next.delete('novo')
          next.delete('clienteId')
        }
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
  const clientsById = useMemo(() => new Map((clients ?? []).map((client) => [client.id, client])), [clients])
  const productsById = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product])),
    [products],
  )
  const currency = getLocaleConfig(locale).currency
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const contracts = data?.contracts
  // Both the chip counts and the narrowing are the server's answers now, over
  // the whole archive rather than over whichever page came back. The week
  // grouping stays client-side on purpose: a group header counts the rows
  // printed under it, so it can only ever describe the page it is drawn on.
  const today = new Date()
  const counts = data?.counts ?? { all: 0, active: 0, overdue: 0, unsigned: 0 }
  const weekGroups = WEEK_GROUP_ORDER.map((key) => ({
    key,
    label: t(`groups.${key}`),
    rows: (contracts ?? []).filter((contract) => contractWeekGroup(contract, today) === key),
  }))
    .filter((group) => group.rows.length > 0)
    .map((group) => ({ ...group, meta: group.rows.length }))
  const pageSize = data?.pageSize ?? 20
  const currentPage = data?.page ?? page
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))

  function handleSearchChange(value: string) {
    setSearch(value)
    setPage(1)
  }

  // Page 3 of "Todos" is very unlikely to exist under "Atrasados", and
  // landing on an empty page reads as "no results" rather than as a paging
  // accident.
  function handleFilterChange(next: ContractStatusFilter) {
    setFilter(next)
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
        filters={(['active', 'overdue', 'unsigned', 'all'] as const).map((key) => (
          <FilterChip key={key} active={filter === key} onClick={() => handleFilterChange(key)} count={counts[key]}>
            {t(`filters.${key}`)}
          </FilterChip>
        ))}
        actions={
          <Button onClick={() => setShowForm(true)} data-tour="contracts.create">
            {t('newContract')}
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 border-t border-border-strong" data-tour="contracts.card">
        <DataList
          columns={columns}
          groups={weekGroups}
          rowKey={(contract) => contract.id}
          rowLabel={(contract) => `#${contract.number} — ${clientsById.get(contract.clientId)?.name ?? ''}`.trim()}
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
            client={selected ? clientsById.get(selected.clientId) : undefined}
            clientName={selected ? (clientNames.get(selected.clientId) ?? selected.clientId) : ''}
            productNames={productNames}
            products={productsById}
          />
        </aside>
      </div>
      {showForm && (
        <NewContractForm
          // Remounts when the preselected client changes, so the form picks
          // up the new default rather than keeping the first one it saw.
          key={presetClientId ?? 'new'}
          clientId={presetClientId}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  )
}
