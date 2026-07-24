import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { CurrencyInput } from '../../components/ui/currency-input.tsx'
import { Modal } from '../../components/ui/modal.tsx'
import { parseDateOnly, formatDate } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { useClients } from '../clients/useClients.ts'
import { useProducts } from '../products/useProducts.ts'
import {
  useCheckOutAllocation,
  useReturnAllocation,
  useCancelAllocation,
} from '../allocations/useAllocations.ts'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import { useContractsList, useCancelContract } from './useContracts.ts'
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
  const [showCheckOutDialog, setShowCheckOutDialog] = useState(false)
  const [showReturnDialog, setShowReturnDialog] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [conditionNotesOut, setConditionNotesOut] = useState('')
  const [depositCollected, setDepositCollected] = useState(0)
  const [conditionNotesIn, setConditionNotesIn] = useState('')
  const [depositReturned, setDepositReturned] = useState(0)

  function showActionError(error: unknown) {
    const code = resolveErrorCode(error)
    showErrorToast(t(`errors.${code}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) }))
  }

  async function handleCheckOut() {
    try {
      await checkOut.mutateAsync({ id: allocation.id, conditionNotesOut, depositCollected })
      setShowCheckOutDialog(false)
    } catch (error) {
      showActionError(error)
    }
  }

  async function handleReturn() {
    try {
      await returnAllocation.mutateAsync({ id: allocation.id, conditionNotesIn, depositReturned })
      setShowReturnDialog(false)
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
        <Modal open={showCheckOutDialog} onClose={() => setShowCheckOutDialog(false)} title={t('checkOutDialog.title')}>
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
              <Button type="button" variant="secondary" onClick={() => setShowCheckOutDialog(false)}>
                {t('common:actions.cancel', { ns: 'common' })}
              </Button>
              <Button type="button" onClick={handleCheckOut} disabled={checkOut.isPending}>
                {t('checkOutDialog.confirm')}
              </Button>
            </div>
          </div>
        </Modal>
        <Modal
          open={showCancelConfirm}
          onClose={() => setShowCancelConfirm(false)}
          title={t('common:confirmCancelAllocation.title', { ns: 'common' })}
        >
          <p className="mb-4 text-sm text-ink">{t('common:confirmCancelAllocation.message', { ns: 'common' })}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setShowCancelConfirm(false)}>
              {t('common:actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="button" onClick={handleCancel} disabled={cancel.isPending}>
              {t('common:confirmCancelAllocation.confirm', { ns: 'common' })}
            </Button>
          </div>
        </Modal>
      </div>
    )
  }
  if (allocation.status === 'checked_out') {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button size="sm" onClick={() => setShowReturnDialog(true)} disabled={returnAllocation.isPending}>
          {t('actions.return')}
        </Button>
        <Modal open={showReturnDialog} onClose={() => setShowReturnDialog(false)} title={t('returnDialog.title')}>
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
              <Button type="button" variant="secondary" onClick={() => setShowReturnDialog(false)}>
                {t('common:actions.cancel', { ns: 'common' })}
              </Button>
              <Button type="button" onClick={handleReturn} disabled={returnAllocation.isPending}>
                {t('returnDialog.confirm')}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    )
  }
  return null
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
      <Modal open={showConfirm} onClose={() => setShowConfirm(false)} title={t('cancelContract.confirmTitle')}>
        <p className="mb-4 text-sm text-ink">{t('cancelContract.confirmMessage')}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setShowConfirm(false)}>
            {t('common:actions.cancel', { ns: 'common' })}
          </Button>
          <Button type="button" onClick={handleCancel} disabled={cancelContract.isPending}>
            {t('cancelContract.confirm')}
          </Button>
        </div>
      </Modal>
    </>
  )
}

function ContractSignAction({ contract }: { contract: Contract }) {
  const { t } = useTranslation('contracts')
  const [showModal, setShowModal] = useState(false)

  if (contract.signatureStatus === 'signed') return null

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setShowModal(true)}>
        {t('sign.action')}
      </Button>
      <SignRemotelyModal contractId={contract.id} open={showModal} onClose={() => setShowModal(false)} />
    </>
  )
}

export function ContractsPage() {
  const { t } = useTranslation('contracts')
  const { locale } = useLocale()
  const { data: contracts, isLoading } = useContractsList()
  const { data: products } = useProducts()
  const { data: clients } = useClients()
  const [showForm, setShowForm] = useState(false)

  const productNames = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product.name])),
    [products],
  )
  const clientNames = useMemo(
    () => new Map((clients ?? []).map((client) => [client.id, client.name])),
    [clients],
  )

  if (isLoading) return <div>{t('title')}</div>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button onClick={() => setShowForm(true)}>{t('newContract')}</Button>
      </div>
      {contracts && contracts.length === 0 && <p className="text-muted-text">{t('empty')}</p>}
      <div className="flex flex-col gap-3">
        {contracts?.map((contract) => (
          <div key={contract.id} className="rounded-md border border-border-soft p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="font-medium">
                  #{contract.number} — <span>{clientNames.get(contract.clientId) ?? contract.clientId}</span>
                </span>
                <span className="text-xs text-muted-text">
                  {formatDate(parseDateOnly(contract.eventDate), locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/contratos/${contract.id}/imprimir`}
                  className="inline-flex h-8 items-center justify-center rounded-md border border-border-soft bg-white px-3 text-sm font-medium text-ink transition-colors hover:border-brand-300 hover:bg-brand-50"
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
                  className="flex items-center justify-between gap-3 rounded-md border border-border-soft p-2 text-sm"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium">
                      {productNames.get(allocation.productId) ?? allocation.productId}
                    </span>
                    <span className="text-xs text-muted-text">
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
          </div>
        ))}
      </div>
      {showForm && <NewContractForm onClose={() => setShowForm(false)} />}
    </div>
  )
}
