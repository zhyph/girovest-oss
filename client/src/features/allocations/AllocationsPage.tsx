import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import {
  useAllocationsList,
  useCheckOutAllocation,
  useReturnAllocation,
  useCancelAllocation,
} from './useAllocations.ts'
import { NewAllocationForm } from './NewAllocationForm.tsx'
import type { Allocation } from './allocationSchemas.ts'

function resolveErrorCode(error: unknown): string {
  return (error as { code?: string })?.code ?? 'UNKNOWN'
}

function RowActions({ allocation }: { allocation: Allocation }) {
  const { t } = useTranslation('allocations')
  const checkOut = useCheckOutAllocation()
  const returnAllocation = useReturnAllocation()
  const cancel = useCancelAllocation()
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const errorMessage = errorCode
    ? t(`errors.${errorCode}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) })
    : null

  async function handleCheckOut() {
    setErrorCode(null)
    try {
      await checkOut.mutateAsync({ id: allocation.id })
    } catch (error) {
      setErrorCode(resolveErrorCode(error))
    }
  }

  async function handleReturn() {
    setErrorCode(null)
    try {
      await returnAllocation.mutateAsync({ id: allocation.id })
    } catch (error) {
      setErrorCode(resolveErrorCode(error))
    }
  }

  async function handleCancel() {
    setErrorCode(null)
    try {
      await cancel.mutateAsync(allocation.id)
    } catch (error) {
      setErrorCode(resolveErrorCode(error))
    }
  }

  if (allocation.status === 'reserved') {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex gap-2">
          <Button size="sm" onClick={handleCheckOut}>
            {t('actions.checkOut')}
          </Button>
          <Button size="sm" variant="secondary" onClick={handleCancel}>
            {t('actions.cancel')}
          </Button>
        </div>
        {errorMessage && <span className="text-xs text-red-600">{errorMessage}</span>}
      </div>
    )
  }
  if (allocation.status === 'checked_out') {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button size="sm" onClick={handleReturn}>
          {t('actions.return')}
        </Button>
        {errorMessage && <span className="text-xs text-red-600">{errorMessage}</span>}
      </div>
    )
  }
  return null
}

export function AllocationsPage() {
  const { t } = useTranslation('allocations')
  const { data: allocations, isLoading } = useAllocationsList()
  const [showForm, setShowForm] = useState(false)

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
          <div key={allocation.id} className="flex items-center justify-between rounded-md p-2 text-sm">
            <span>{t(`status.${allocation.status}`)}</span>
            <RowActions allocation={allocation} />
          </div>
        ))}
      </div>
      {showForm && <NewAllocationForm onClose={() => setShowForm(false)} />}
    </div>
  )
}
