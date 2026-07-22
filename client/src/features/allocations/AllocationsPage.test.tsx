import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { AllocationsPage } from './AllocationsPage.tsx'
import * as useAllocationsModule from './useAllocations.ts'
import * as useProductsModule from '../products/useProducts.ts'
import * as useClientsModule from '../clients/useClients.ts'
import { ToastProvider } from '../../components/ui/toast.tsx'
import type { Allocation } from './allocationSchemas.ts'

function renderWithToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>)
}

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
    isPending: false,
  } as never)
  vi.spyOn(useAllocationsModule, 'useReturnAllocation').mockReturnValue({
    mutateAsync: overrides.returnAllocation ?? vi.fn(),
    isPending: false,
  } as never)
  vi.spyOn(useAllocationsModule, 'useCancelAllocation').mockReturnValue({
    mutateAsync: overrides.cancel ?? vi.fn(),
    isPending: false,
  } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({
    data: [{ id: 'p1', name: 'Vestido Azul' }],
  } as never)
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
    data: [{ id: 'c1', name: 'Maria Silva' }],
  } as never)
}

describe('AllocationsPage', () => {
  it('shows Check-out/Cancelar for a reserved row', () => {
    mockAllocationHooks([reserved])
    renderWithToast(<AllocationsPage />)
    expect(screen.getByRole('button', { name: 'Check-out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
  })

  it('shows Devolver for a checked_out row', () => {
    mockAllocationHooks([checkedOut])
    renderWithToast(<AllocationsPage />)
    expect(screen.getByRole('button', { name: 'Devolver' })).toBeInTheDocument()
  })

  it('shows no action buttons for a returned row', () => {
    mockAllocationHooks([returned])
    renderWithToast(<AllocationsPage />)
    expect(screen.queryByRole('button', { name: 'Check-out' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Devolver' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()
  })

  it('shows a translated error when check-out is rejected with INVALID_ALLOCATION_TRANSITION', async () => {
    const checkOut = vi.fn().mockRejectedValue({ code: 'INVALID_ALLOCATION_TRANSITION' })
    mockAllocationHooks([reserved], { checkOut })
    renderWithToast(<AllocationsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Check-out' }))
    const dialog = screen.getByRole('dialog', { name: 'Check-out' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar check-out' }))

    expect(
      await screen.findByText('Esta ação não é permitida no status atual.'),
    ).toBeInTheDocument()
  })

  it('shows a fallback error when cancel is rejected with an unknown code', async () => {
    const cancel = vi.fn().mockRejectedValue({ code: 'SOMETHING_WEIRD' })
    mockAllocationHooks([reserved], { cancel })
    renderWithToast(<AllocationsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    const dialog = screen.getByRole('dialog', { name: 'Cancelar esta alocação?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sim, cancelar' }))

    expect(await screen.findByText('Algo deu errado. Tente novamente.')).toBeInTheDocument()
  })

  it('sends condition notes and deposit collected when confirming check-out', async () => {
    const checkOut = vi.fn().mockResolvedValue(undefined)
    mockAllocationHooks([reserved], { checkOut })
    renderWithToast(<AllocationsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Check-out' }))
    const dialog = screen.getByRole('dialog', { name: 'Check-out' })
    await userEvent.type(within(dialog).getByLabelText('Estado do produto na saída'), 'Sem manchas')
    await userEvent.type(within(dialog).getByLabelText('Caução recebida'), '5000')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar check-out' }))

    expect(checkOut).toHaveBeenCalledWith({
      id: 'a1', conditionNotesOut: 'Sem manchas', depositCollected: 50,
    })
  })

  it('sends condition notes and deposit returned when confirming a return', async () => {
    const returnAllocation = vi.fn().mockResolvedValue(undefined)
    mockAllocationHooks([checkedOut], { returnAllocation })
    renderWithToast(<AllocationsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Devolver' }))
    const dialog = screen.getByRole('dialog', { name: 'Devolução' })
    await userEvent.type(within(dialog).getByLabelText('Estado do produto na devolução'), 'Bom estado')
    await userEvent.type(within(dialog).getByLabelText('Caução devolvida'), '5000')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar devolução' }))

    expect(returnAllocation).toHaveBeenCalledWith({
      id: 'a2', conditionNotesIn: 'Bom estado', depositReturned: 50,
    })
  })
})
