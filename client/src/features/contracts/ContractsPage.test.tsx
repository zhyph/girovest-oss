import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import '../../i18n.ts'
import { ContractsPage } from './ContractsPage.tsx'
import * as useContractsModule from './useContracts.ts'
import * as useProductsModule from '../products/useProducts.ts'
import * as useClientsModule from '../clients/useClients.ts'
import * as useAllocationsModule from '../allocations/useAllocations.ts'
import type { Contract } from './contractSchemas.ts'

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient()
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

const contract: Contract = {
  id: 'ct1', number: 3, locationId: 'loc1', clientId: 'c1', staffId: 's1',
  eventDate: '2026-10-03', paymentMethod: 'PIX', signatureStatus: 'unsigned',
  signatureImage: null, signedAt: null, createdAt: '2026-09-01',
  allocations: [
    {
      id: 'a1', productId: 'p1', clientId: 'c1', staffId: 's1', contractId: 'ct1',
      checkoutDate: '2026-10-02', dueDate: '2026-10-06', actualReturnDate: null,
      status: 'reserved', priceCharged: 380, depositCollected: null, depositReturned: null,
      conditionNotesOut: null, conditionNotesIn: null, createdAt: '2026-09-01',
    },
  ],
  installments: [{ id: 'i1', contractId: 'ct1', dueDate: '2026-09-20', amount: 380, paid: false, paidAt: null }],
}

function mockHooks(overrides: { contracts?: Contract[]; cancelImpl?: (...args: never[]) => Promise<unknown> } = {}) {
  const contracts = overrides.contracts ?? [contract]
  vi.spyOn(useContractsModule, 'useContractsList').mockReturnValue({
    data: { contracts, total: contracts.length, page: 1, pageSize: 20 },
    isLoading: false,
  } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [{ id: 'p1', name: 'Vestido Azul' }] } as never)
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [{ id: 'c1', name: 'Maria' }] } as never)
  vi.spyOn(useContractsModule, 'useCancelContract').mockReturnValue({
    mutateAsync: overrides.cancelImpl ?? vi.fn(),
    isPending: false,
  } as never)
  vi.spyOn(useContractsModule, 'useContract').mockReturnValue({ data: overrides.contracts?.[0] ?? contract } as never)
  vi.spyOn(useContractsModule, 'useIssueSigningToken').mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ token: 't', expiresAt: new Date().toISOString(), port: 3000, candidates: [] }),
    isPending: false,
  } as never)
}

describe('ContractsPage', () => {
  it('shows the contract number, client, and its line item', () => {
    mockHooks()
    renderWithProviders(<ContractsPage />)
    expect(screen.getByText(/#3/)).toBeInTheDocument()
    expect(screen.getByText('Maria')).toBeInTheDocument()
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Imprimir' })).toHaveAttribute('href', '/contratos/ct1/imprimir')
  })

  it('shows the New Contract button and opens the form', async () => {
    mockHooks()
    renderWithProviders(<ContractsPage />)
    await userEvent.click(screen.getByRole('button', { name: /novo contrato/i }))
    expect(screen.getByLabelText('Cliente')).toBeInTheDocument()
  })

  it('shows the reserved item\'s check-out action', () => {
    mockHooks()
    renderWithProviders(<ContractsPage />)
    expect(screen.getByRole('button', { name: 'Check-out' })).toBeInTheDocument()
  })

  it('shows a cancel-contract action when the contract has a reserved item, and cancels on confirm', async () => {
    const cancelImpl = vi.fn().mockResolvedValue(undefined)
    mockHooks({ cancelImpl })
    renderWithProviders(<ContractsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar contrato' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar contrato' }))

    expect(cancelImpl).toHaveBeenCalledWith('ct1')
  })

  it('hides the cancel-contract action when no items are reserved', () => {
    const returnedContract: Contract = {
      ...contract,
      allocations: [{ ...contract.allocations[0], status: 'returned' }],
    }
    mockHooks({ contracts: [returnedContract] })
    renderWithProviders(<ContractsPage />)
    expect(screen.queryByRole('button', { name: 'Cancelar contrato' })).not.toBeInTheDocument()
  })

  it('shows a sign-remotely action for an unsigned contract', () => {
    mockHooks()
    renderWithProviders(<ContractsPage />)
    expect(screen.getByRole('button', { name: 'Assinar remotamente' })).toBeInTheDocument()
  })

  it('hides the sign-remotely action once the contract is signed', () => {
    const signedContract: Contract = { ...contract, signatureStatus: 'signed' }
    mockHooks({ contracts: [signedContract] })
    renderWithProviders(<ContractsPage />)
    expect(screen.queryByRole('button', { name: 'Assinar remotamente' })).not.toBeInTheDocument()
  })

  it('shows pagination controls and a search box, and searching resets to page 1', async () => {
    const listSpy = vi.spyOn(useContractsModule, 'useContractsList').mockReturnValue({
      data: { contracts: [contract], total: 25, page: 1, pageSize: 20 },
      isLoading: false,
    } as never)
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [{ id: 'p1', name: 'Vestido Azul' }] } as never)
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [{ id: 'c1', name: 'Maria' }] } as never)
    vi.spyOn(useContractsModule, 'useCancelContract').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
    vi.spyOn(useContractsModule, 'useIssueSigningToken').mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ token: 't', expiresAt: new Date().toISOString(), port: 3000, candidates: [] }),
      isPending: false,
    } as never)

    renderWithProviders(<ContractsPage />)

    expect(screen.getByLabelText(/buscar/i)).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/buscar/i), 'maria')

    expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: 'maria' }))
  })
})

const checkedOutContract: Contract = {
  ...contract,
  allocations: [{ ...contract.allocations[0], status: 'checked_out' }],
}

function mockAllocationHooks(
  overrides: {
    checkOutImpl?: (...args: never[]) => Promise<unknown>
    returnImpl?: (...args: never[]) => Promise<unknown>
    cancelAllocationImpl?: (...args: never[]) => Promise<unknown>
  } = {},
) {
  vi.spyOn(useAllocationsModule, 'useCheckOutAllocation').mockReturnValue({
    mutateAsync: overrides.checkOutImpl ?? vi.fn().mockResolvedValue(undefined),
    isPending: false,
  } as never)
  vi.spyOn(useAllocationsModule, 'useReturnAllocation').mockReturnValue({
    mutateAsync: overrides.returnImpl ?? vi.fn().mockResolvedValue(undefined),
    isPending: false,
  } as never)
  vi.spyOn(useAllocationsModule, 'useCancelAllocation').mockReturnValue({
    mutateAsync: overrides.cancelAllocationImpl ?? vi.fn().mockResolvedValue(undefined),
    isPending: false,
  } as never)
}

// The pt-BR currency formatter separates symbol and amount with a non-breaking
// space, so normalise before comparing against a plain-space literal.
function currencyValue(label: string) {
  return (screen.getByLabelText(label) as HTMLInputElement).value.replace(/\u00a0/g, ' ')
}

describe('ContractsPage allocation dialogs', () => {
  it('prompts before discarding typed check-out notes', async () => {
    mockHooks()
    mockAllocationHooks()
    renderWithProviders(<ContractsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Check-out' }))
    await userEvent.type(screen.getByLabelText('Estado do produto na saída'), 'pequeno rasgo')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(screen.getByLabelText('Estado do produto na saída')).toHaveValue('pequeno rasgo')
  })

  it('keeps the check-out notes when Continuar editando is chosen', async () => {
    mockHooks()
    mockAllocationHooks()
    renderWithProviders(<ContractsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Check-out' }))
    await userEvent.type(screen.getByLabelText('Estado do produto na saída'), 'pequeno rasgo')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar editando' }))

    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Estado do produto na saída')).toHaveValue('pequeno rasgo')
  })

  it('clears the check-out fields after discarding, so reopening starts fresh', async () => {
    mockHooks()
    mockAllocationHooks()
    renderWithProviders(<ContractsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Check-out' }))
    await userEvent.type(screen.getByLabelText('Estado do produto na saída'), 'pequeno rasgo')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    expect(screen.queryByLabelText('Estado do produto na saída')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Check-out' }))

    expect(screen.getByLabelText('Estado do produto na saída')).toHaveValue('')
    expect(currencyValue('Caução recebida')).toBe('R$ 0,00')
  })

  it('closes the check-out dialog straight away when nothing was typed', async () => {
    mockHooks()
    mockAllocationHooks()
    renderWithProviders(<ContractsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Check-out' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Estado do produto na saída')).not.toBeInTheDocument()
  })

  it('clears the check-out fields after a successful check-out', async () => {
    mockHooks()
    const checkOutImpl = vi.fn().mockResolvedValue(undefined)
    mockAllocationHooks({ checkOutImpl })
    renderWithProviders(<ContractsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Check-out' }))
    await userEvent.type(screen.getByLabelText('Estado do produto na saída'), 'pequeno rasgo')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar check-out' }))

    expect(checkOutImpl).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByRole('button', { name: 'Check-out' }))
    expect(screen.getByLabelText('Estado do produto na saída')).toHaveValue('')
  })

  it('prompts before discarding typed return notes, and clears them after discarding', async () => {
    mockHooks({ contracts: [checkedOutContract] })
    mockAllocationHooks()
    renderWithProviders(<ContractsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Devolver' }))
    await userEvent.type(screen.getByLabelText('Estado do produto na devolução'), 'tudo certo')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Devolver' }))

    expect(screen.getByLabelText('Estado do produto na devolução')).toHaveValue('')
    expect(currencyValue('Caução devolvida')).toBe('R$ 0,00')
  })

  it('does not guard the pure cancel-allocation confirmation, which carries no input', async () => {
    mockHooks()
    const cancelAllocationImpl = vi.fn().mockResolvedValue(undefined)
    mockAllocationHooks({ cancelAllocationImpl })
    renderWithProviders(<ContractsPage />)

    const rowCancel = screen.getAllByRole('button', { name: 'Cancelar' })[0]
    await userEvent.click(rowCancel)
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sim, cancelar' }))

    expect(cancelAllocationImpl).toHaveBeenCalledWith('a1')
    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument()
  })
})
