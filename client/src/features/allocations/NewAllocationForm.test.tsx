import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { NewAllocationForm } from './NewAllocationForm.tsx'
import * as useClientsModule from '../clients/useClients.ts'
import * as useProductsModule from '../products/useProducts.ts'
import * as useAllocationsModule from './useAllocations.ts'
import { ToastProvider } from '../../components/ui/toast.tsx'

function renderWithToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>)
}

const client = { id: 'c1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }
const product = {
  id: 'p1', locationId: 'l1', name: 'Vestido Azul', category: 'casual', size: 'P', color: 'azul',
  rentalPrice: 150, depositAmount: 50, status: 'active' as const, createdAt: '2026-01-01',
}

function mockPickerHooks(available: boolean) {
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [client], isLoading: false } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product], isLoading: false } as never)
  vi.spyOn(useAllocationsModule, 'useCreateAllocation').mockReturnValue({ mutateAsync: vi.fn() } as never)
  vi.spyOn(useAllocationsModule, 'useProductAvailability').mockReturnValue({ data: { available } } as never)
}

describe('NewAllocationForm', () => {
  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn()
    mockPickerHooks(true)
    const { container } = renderWithToast(<NewAllocationForm onClose={onClose} />)

    await userEvent.click(container.querySelector('[aria-hidden="true"]')!)

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('disables Salvar and shows a warning when the product is unavailable for the chosen range', async () => {
    mockPickerHooks(false)
    renderWithToast(<NewAllocationForm onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Data de saída'), '01082026')
    await userEvent.type(screen.getByLabelText('Data de devolução'), '05082026')
    await userEvent.selectOptions(screen.getByLabelText('Produto'), 'p1')

    expect(screen.getByText('Não disponível no período escolhido')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('leaves Salvar enabled when the product is available for the chosen range', async () => {
    mockPickerHooks(true)
    renderWithToast(<NewAllocationForm onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Data de saída'), '01082026')
    await userEvent.type(screen.getByLabelText('Data de devolução'), '05082026')
    await userEvent.selectOptions(screen.getByLabelText('Produto'), 'p1')

    expect(screen.queryByText('Não disponível no período escolhido')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled()
  })

  it('masks the date fields as DD/MM/AAAA regardless of OS locale', async () => {
    mockPickerHooks(true)
    renderWithToast(<NewAllocationForm onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Data de saída'), '01082026')

    expect(screen.getByLabelText('Data de saída')).toHaveValue('01/08/2026')
  })
})
