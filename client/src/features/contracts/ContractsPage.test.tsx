import { describe, it, expect, vi, type Mock } from 'vitest'
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
import * as toastModule from '../../lib/toast.ts'
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
      checkoutDate: '2026-10-02', actualCheckoutDate: null, dueDate: '2026-10-06', actualReturnDate: null,
      status: 'reserved', priceCharged: 380, depositCollected: null, depositReturned: null,
      conditionNotesOut: null, conditionNotesIn: null, createdAt: '2026-09-01',
    },
  ],
  installments: [{ id: 'i1', contractId: 'ct1', dueDate: '2026-09-20', amount: 380, paid: false, paidAt: null }],
}

function mockHooks(
  overrides: {
    contracts?: Contract[]
    cancelImpl?: (...args: never[]) => Promise<unknown>
    checkOutImpl?: Mock
  } = {},
) {
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
  const checkOutImpl = overrides.checkOutImpl ?? vi.fn().mockResolvedValue(undefined)
  vi.spyOn(useAllocationsModule, 'useCheckOutAllocation').mockReturnValue({
    mutateAsync: checkOutImpl,
    isPending: false,
  } as never)
  vi.spyOn(useAllocationsModule, 'useReturnAllocation').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
  vi.spyOn(useAllocationsModule, 'useCancelAllocation').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
  return { checkOutImpl }
}

async function openCheckOutAndConfirm() {
  await userEvent.click(screen.getByRole('button', { name: 'Check-out' }))
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar check-out' }))
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

  it('checks out on the first confirmation when the date is not early', async () => {
    const { checkOutImpl } = mockHooks()
    renderWithProviders(<ContractsPage />)

    await openCheckOutAndConfirm()

    expect(checkOutImpl).toHaveBeenCalledTimes(1)
    expect(checkOutImpl).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }))
    expect(checkOutImpl.mock.calls[0][0]).not.toHaveProperty('allowEarly', true)
    expect(screen.queryByRole('button', { name: 'Retirar mesmo assim' })).not.toBeInTheDocument()
  })

  it('offers a confirmation showing the marked date instead of dead-ending on an early check-out', async () => {
    const checkOutImpl = vi.fn().mockRejectedValue({ code: 'CHECKOUT_TOO_EARLY' })
    mockHooks({ checkOutImpl })
    renderWithProviders(<ContractsPage />)

    await openCheckOutAndConfirm()

    const confirmButton = screen.getByRole('button', { name: 'Retirar mesmo assim' })
    const dialog = confirmButton.closest('[role="dialog"]') as HTMLElement
    expect(within(dialog).getByText(/02\/10\/2026/)).toBeInTheDocument()
  })

  it('repeats the check-out with the override once the early pickup is confirmed', async () => {
    const checkOutImpl = vi
      .fn()
      .mockRejectedValueOnce({ code: 'CHECKOUT_TOO_EARLY' })
      .mockResolvedValueOnce(undefined)
    mockHooks({ checkOutImpl })
    renderWithProviders(<ContractsPage />)

    await openCheckOutAndConfirm()
    await userEvent.click(screen.getByRole('button', { name: 'Retirar mesmo assim' }))

    expect(checkOutImpl).toHaveBeenCalledTimes(2)
    expect(checkOutImpl).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a1', allowEarly: true }))
    expect(screen.queryByRole('button', { name: 'Retirar mesmo assim' })).not.toBeInTheDocument()
  })

  it('leaves the allocation untouched when the early pickup is dismissed', async () => {
    const checkOutImpl = vi.fn().mockRejectedValue({ code: 'CHECKOUT_TOO_EARLY' })
    mockHooks({ checkOutImpl })
    renderWithProviders(<ContractsPage />)

    await openCheckOutAndConfirm()
    const dialog = screen.getByRole('button', { name: 'Retirar mesmo assim' }).closest('[role="dialog"]') as HTMLElement
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))

    expect(checkOutImpl).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Retirar mesmo assim' })).not.toBeInTheDocument()
  })

  it('still toasts other check-out failures instead of offering the early override', async () => {
    const toastSpy = vi.spyOn(toastModule, 'showErrorToast').mockImplementation(() => {})
    const checkOutImpl = vi.fn().mockRejectedValue({ code: 'INVALID_ALLOCATION_TRANSITION' })
    mockHooks({ checkOutImpl })
    renderWithProviders(<ContractsPage />)

    await openCheckOutAndConfirm()

    expect(screen.queryByRole('button', { name: 'Retirar mesmo assim' })).not.toBeInTheDocument()
    expect(toastSpy).toHaveBeenCalledWith('Esta ação não é permitida no status atual.')
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
