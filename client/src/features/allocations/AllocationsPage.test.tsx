import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { AllocationsPage } from './AllocationsPage.tsx'
import * as useAllocationsModule from './useAllocations.ts'
import type { Allocation } from './allocationSchemas.ts'

const reserved: Allocation = {
  id: 'a1', productId: 'p1', clientId: 'c1', staffId: 's1', checkoutDate: '2026-08-01', dueDate: '2026-08-05',
  actualReturnDate: null, status: 'reserved' as const, priceCharged: 100, depositCollected: null,
  depositReturned: null, conditionNotesOut: null, conditionNotesIn: null, createdAt: '2026-07-01',
}
const checkedOut = { ...reserved, id: 'a2', status: 'checked_out' as const }
const returned = { ...reserved, id: 'a3', status: 'returned' as const }

function mockAllocationHooks(
  list: Allocation[],
  overrides: {
    checkOut?: ReturnType<typeof vi.fn>
    returnAllocation?: ReturnType<typeof vi.fn>
    cancel?: ReturnType<typeof vi.fn>
  } = {},
) {
  vi.spyOn(useAllocationsModule, 'useAllocationsList').mockReturnValue({ data: list, isLoading: false } as never)
  vi.spyOn(useAllocationsModule, 'useCheckOutAllocation').mockReturnValue({
    mutateAsync: overrides.checkOut ?? vi.fn(),
  } as never)
  vi.spyOn(useAllocationsModule, 'useReturnAllocation').mockReturnValue({
    mutateAsync: overrides.returnAllocation ?? vi.fn(),
  } as never)
  vi.spyOn(useAllocationsModule, 'useCancelAllocation').mockReturnValue({
    mutateAsync: overrides.cancel ?? vi.fn(),
  } as never)
}

describe('AllocationsPage', () => {
  it('shows Check-out/Cancelar for a reserved row', () => {
    mockAllocationHooks([reserved])
    render(<AllocationsPage />)
    expect(screen.getByRole('button', { name: 'Check-out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
  })

  it('shows Devolver for a checked_out row', () => {
    mockAllocationHooks([checkedOut])
    render(<AllocationsPage />)
    expect(screen.getByRole('button', { name: 'Devolver' })).toBeInTheDocument()
  })

  it('shows no action buttons for a returned row', () => {
    mockAllocationHooks([returned])
    render(<AllocationsPage />)
    expect(screen.queryByRole('button', { name: 'Check-out' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Devolver' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()
  })

  it('shows a translated error when check-out is rejected with INVALID_ALLOCATION_TRANSITION', async () => {
    const checkOut = vi.fn().mockRejectedValue({ code: 'INVALID_ALLOCATION_TRANSITION' })
    mockAllocationHooks([reserved], { checkOut })
    render(<AllocationsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Check-out' }))

    expect(
      await screen.findByText('Esta ação não é permitida no status atual.'),
    ).toBeInTheDocument()
  })

  it('shows a fallback error when cancel is rejected with an unknown code', async () => {
    const cancel = vi.fn().mockRejectedValue({ code: 'SOMETHING_WEIRD' })
    mockAllocationHooks([reserved], { cancel })
    render(<AllocationsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(await screen.findByText('Algo deu errado. Tente novamente.')).toBeInTheDocument()
  })
})
