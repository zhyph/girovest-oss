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
    setPaidImpl?: Mock
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
  const setPaidImpl = overrides.setPaidImpl ?? vi.fn().mockResolvedValue(undefined)
  vi.spyOn(useContractsModule, 'useSetInstallmentPaid').mockReturnValue({
    mutateAsync: setPaidImpl,
    isPending: false,
  } as never)
  return { checkOutImpl, setPaidImpl }
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

  it('names the real reason when the confirmed early pickup collides with another booking', async () => {
    const toastSpy = vi.spyOn(toastModule, 'showErrorToast').mockImplementation(() => {})
    const checkOutImpl = vi
      .fn()
      .mockRejectedValueOnce({ code: 'CHECKOUT_TOO_EARLY' })
      .mockRejectedValueOnce({ code: 'EARLY_CHECKOUT_CONFLICT' })
    mockHooks({ checkOutImpl })
    renderWithProviders(<ContractsPage />)

    await openCheckOutAndConfirm()
    await userEvent.click(screen.getByRole('button', { name: 'Retirar mesmo assim' }))

    // Not the generic "erro inesperado" — the operator has to know the dress is
    // promised to someone else, otherwise they just try again.
    expect(toastSpy).toHaveBeenCalledWith(
      'Este produto está reservado para outro cliente antes da data de saída marcada. Só é possível retirar agora se essa outra reserva for alterada.',
    )
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

describe('payments summary', () => {
  it('always shows the money, so a long contract can be scanned without expanding it', () => {
    mockHooks()
    renderWithProviders(<ContractsPage />)

    expect(screen.getByText(/Total:/)).toBeInTheDocument()
    expect(screen.getByText(/Em aberto:/)).toBeInTheDocument()
    expect(screen.getByText('0 de 1 pagas')).toBeInTheDocument()
  })

  it('keeps the instalment rows collapsed so a 12x contract cannot swamp the list', () => {
    mockHooks({
      contracts: [
        {
          ...contract,
          installments: Array.from({ length: 12 }, (_, index) => ({
            id: `i${index}`,
            contractId: 'ct1',
            dueDate: '2026-09-20',
            amount: 100,
            paid: false,
            paidAt: null,
          })),
        },
      ],
    })
    renderWithProviders(<ContractsPage />)

    expect(screen.queryByRole('button', { name: 'Marcar como pago' })).not.toBeInTheDocument()
    expect(screen.getByText('0 de 12 pagas')).toBeInTheDocument()
  })

  it('reveals the instalment rows when the summary is opened', async () => {
    mockHooks()
    renderWithProviders(<ContractsPage />)

    await userEvent.click(screen.getByRole('button', { name: /Pagamentos/ }))

    expect(screen.getByRole('button', { name: 'Marcar como pago' })).toBeInTheDocument()
  })

  it('sends the paid flag for the instalment that was toggled', async () => {
    const { setPaidImpl } = mockHooks({
      contracts: [
        {
          ...contract,
          installments: [{ id: 'i1', contractId: 'ct1', dueDate: '2026-09-20', amount: 380, paid: false, paidAt: null }],
        },
      ],
    })
    renderWithProviders(<ContractsPage />)
    await userEvent.click(screen.getByRole('button', { name: /Pagamentos/ }))

    await userEvent.click(screen.getByRole('button', { name: 'Marcar como pago' }))

    expect(setPaidImpl).toHaveBeenCalledWith({ contractId: 'ct1', installmentId: 'i1', paid: true })
  })
})
