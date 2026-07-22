import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { CurrencyInput } from '../../components/ui/currency-input.tsx'
import { Modal } from '../../components/ui/modal.tsx'
import { Badge } from '../../components/ui/badge.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { parseDateOnly } from '../../lib/date.ts'
import { useClients } from '../clients/useClients.ts'
import { useProducts } from '../products/useProducts.ts'
import {
  useAllocationsList,
  useCheckOutAllocation,
  useReturnAllocation,
  useCancelAllocation,
} from './useAllocations.ts'
import { NewAllocationForm } from './NewAllocationForm.tsx'
import type { Allocation } from './allocationSchemas.ts'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })

const STATUS_TONE: Record<Allocation['status'], 'neutral' | 'success' | 'warning' | 'danger'> = {
  reserved: 'neutral',
  checked_out: 'warning',
  returned: 'success',
  cancelled: 'neutral',
}

function resolveErrorCode(error: unknown): string {
  return (error as { code?: string })?.code ?? 'UNKNOWN'
}

function RowActions({ allocation }: { allocation: Allocation }) {
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

export function AllocationsPage() {
  const { t } = useTranslation('allocations')
  const { data: allocations, isLoading } = useAllocationsList()
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
        <Button onClick={() => setShowForm(true)}>{t('newAllocation')}</Button>
      </div>
      {allocations && allocations.length === 0 && <p className="text-muted">{t('empty')}</p>}
      <div className="flex flex-col gap-1">
        {allocations?.map((allocation) => (
          <div
            key={allocation.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border-soft p-2 text-sm"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium">{productNames.get(allocation.productId) ?? allocation.productId}</span>
              <span className="truncate text-muted">{clientNames.get(allocation.clientId) ?? allocation.clientId}</span>
              <span className="text-xs text-muted">
                {dateFormatter.format(parseDateOnly(allocation.checkoutDate))} –{' '}
                {dateFormatter.format(parseDateOnly(allocation.dueDate))}
              </span>
              <Badge className="self-start" tone={STATUS_TONE[allocation.status]}>{t(`status.${allocation.status}`)}</Badge>
            </div>
            <div className="shrink-0">
              <RowActions allocation={allocation} />
            </div>
          </div>
        ))}
      </div>
      {showForm && <NewAllocationForm onClose={() => setShowForm(false)} />}
    </div>
  )
}
