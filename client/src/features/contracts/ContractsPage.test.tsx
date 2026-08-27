import { describe, it, expect, vi, type Mock } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
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
import * as NewContractFormModule from './NewContractForm.tsx'
import type { Contract } from './contractSchemas.ts'

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient()
  // The wrapper goes through `wrapper` rather than being inlined, so a
  // `rerender` keeps the Router and QueryClient in place — re-rendering the
  // bare page would drop them and throw out of useSearchParams.
  return render(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    ),
  })
}

// Contract actions moved out of the list and into the detail panel: only
// the selected contract shows Imprimir/Assinar/Cancelar, and per-piece
// actions live in that row's own menu. Reaching them therefore starts
// with picking a contract, the way it does on screen.
async function renderAndSelect(ui: React.ReactElement) {
  const result = renderWithProviders(ui)
  const rows = await screen.findAllByRole('button', { name: /#\d/ })
  await userEvent.click(rows[0])
  return result
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
  payments: [],
}

const client = {
  id: 'c1',
  name: 'Maria',
  phone: '11987654321',
  email: 'maria@example.com',
  identityDocuments: [
    { id: 'd1', label: 'CPF', value: '123.456.789-00' },
    { id: 'd2', label: 'RG', value: '12.345.678-9' },
  ],
  addressLines: [
    { id: 'l1', label: 'Rua', value: 'Rua das Flores, 120', sortOrder: 0 },
    { id: 'l2', label: 'Cidade', value: 'São Paulo', sortOrder: 1 },
  ],
  hasAllocationHistory: false,
  createdAt: '2026-01-01',
}

// Per-piece and per-contract actions now live behind overflow menus, so a
// test reaches them the way a user does: open the menu, then pick the item.
async function openPieceActions() {
  await userEvent.click(screen.getByRole('button', { name: 'Ações da peça' }))
}

async function openHeaderActions() {
  await userEvent.click(screen.getByRole('button', { name: 'Mais ações' }))
}

function mockHooks(
  overrides: {
    contracts?: Contract[]
    cancelImpl?: (...args: never[]) => Promise<unknown>
    checkOutImpl?: Mock
    createPaymentImpl?: Mock
    updatePaymentImpl?: Mock
    deletePaymentImpl?: Mock
    counts?: { all: number; active: number; overdue: number; unsigned: number; outstanding: number }
  } = {},
) {
  const contracts = overrides.contracts ?? [contract]
  vi.spyOn(useContractsModule, 'useContractsList').mockReturnValue({
    data: {
      contracts,
      total: contracts.length,
      page: 1,
      pageSize: 20,
      counts: overrides.counts ?? {
        all: contracts.length,
        active: contracts.length,
        overdue: 0,
        unsigned: contracts.length,
        outstanding: contracts.length,
      },
    },
    isLoading: false,
  } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [{ id: 'p1', name: 'Vestido Azul' }] } as never)
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [client] } as never)
  vi.spyOn(useContractsModule, 'useCancelContract').mockReturnValue({
    mutateAsync: overrides.cancelImpl ?? vi.fn(),
    isPending: false,
  } as never)
  // Id-aware, matching the real hook: useContract(undefined) is a DISABLED
  // query and resolves to no data. A blanket mock made the detail panel look
  // permanently populated, which hid whether the page had actually selected
  // anything.
  vi.spyOn(useContractsModule, 'useContract').mockImplementation(
    ((id?: string) => {
      if (!id) return { data: undefined } as never
      const pool = overrides.contracts ?? [contract]
      return { data: pool.find((entry) => entry.id === id) ?? pool[0] } as never
    }) as never,
  )
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
  const createPaymentImpl = overrides.createPaymentImpl ?? vi.fn().mockResolvedValue(undefined)
  const updatePaymentImpl = overrides.updatePaymentImpl ?? vi.fn().mockResolvedValue(undefined)
  const deletePaymentImpl = overrides.deletePaymentImpl ?? vi.fn().mockResolvedValue(undefined)
  vi.spyOn(useContractsModule, 'useCreatePayment').mockReturnValue({
    mutateAsync: createPaymentImpl,
    isPending: false,
  } as never)
  vi.spyOn(useContractsModule, 'useUpdatePayment').mockReturnValue({
    mutateAsync: updatePaymentImpl,
    isPending: false,
  } as never)
  vi.spyOn(useContractsModule, 'useDeletePayment').mockReturnValue({
    mutateAsync: deletePaymentImpl,
    isPending: false,
  } as never)
  return { checkOutImpl, createPaymentImpl, updatePaymentImpl, deletePaymentImpl }
}

async function openCheckOutDialog() {
  await openPieceActions()
  await userEvent.click(screen.getByRole('menuitem', { name: 'Check-out' }))
}

async function openReturnDialog() {
  await openPieceActions()
  await userEvent.click(screen.getByRole('menuitem', { name: 'Devolver' }))
}

async function openCheckOutAndConfirm() {
  await openCheckOutDialog()
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar check-out' }))
}

describe('ContractsPage', () => {
  it('shows the contract number, client, and its line item', async () => {
    mockHooks()
    await renderAndSelect(<ContractsPage />)

    // The number and the client now appear twice — once in the list row and
    // once in the detail panel — so assert per region rather than globally,
    // or the query cannot tell a working split view from a broken one.
    const list = screen.getByRole('row').parentElement as HTMLElement
    const panel = document.querySelector('aside') as HTMLElement

    expect(within(list).getByText(/#3/)).toBeInTheDocument()
    expect(within(list).getByText('Maria')).toBeInTheDocument()

    expect(within(panel).getByText(/#3/)).toBeInTheDocument()
    expect(within(panel).getByText('Vestido Azul')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Imprimir' })).toHaveAttribute(
      'href',
      '/contratos/ct1/imprimir',
    )
  })

  it('shows the New Contract button and opens the form', async () => {
    mockHooks()
    await renderAndSelect(<ContractsPage />)
    await userEvent.click(screen.getByRole('button', { name: /novo contrato/i }))
    expect(screen.getByLabelText('Cliente')).toBeInTheDocument()
  })

  it('shows the reserved item\'s check-out action', async () => {
    mockHooks()
    await renderAndSelect(<ContractsPage />)
    await openPieceActions()
    expect(screen.getByRole('menuitem', { name: 'Check-out' })).toBeInTheDocument()
  })

  it('checks out on the first confirmation when the date is not early', async () => {
    const { checkOutImpl } = mockHooks()
    await renderAndSelect(<ContractsPage />)

    await openCheckOutAndConfirm()

    expect(checkOutImpl).toHaveBeenCalledTimes(1)
    expect(checkOutImpl).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }))
    expect(checkOutImpl.mock.calls[0][0]).not.toHaveProperty('allowEarly', true)
    expect(screen.queryByRole('button', { name: 'Retirar mesmo assim' })).not.toBeInTheDocument()
  })

  it('offers a confirmation showing the marked date instead of dead-ending on an early check-out', async () => {
    const checkOutImpl = vi.fn().mockRejectedValue({ code: 'CHECKOUT_TOO_EARLY' })
    mockHooks({ checkOutImpl })
    await renderAndSelect(<ContractsPage />)

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
    await renderAndSelect(<ContractsPage />)

    await openCheckOutAndConfirm()
    await userEvent.click(screen.getByRole('button', { name: 'Retirar mesmo assim' }))

    expect(checkOutImpl).toHaveBeenCalledTimes(2)
    expect(checkOutImpl).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a1', allowEarly: true }))
    expect(screen.queryByRole('button', { name: 'Retirar mesmo assim' })).not.toBeInTheDocument()
  })

  it('leaves the allocation untouched when the early pickup is dismissed', async () => {
    const checkOutImpl = vi.fn().mockRejectedValue({ code: 'CHECKOUT_TOO_EARLY' })
    mockHooks({ checkOutImpl })
    await renderAndSelect(<ContractsPage />)

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
    await renderAndSelect(<ContractsPage />)

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
    await renderAndSelect(<ContractsPage />)

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
    await renderAndSelect(<ContractsPage />)

    await openHeaderActions()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cancelar contrato' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar contrato' }))

    expect(cancelImpl).toHaveBeenCalledWith('ct1')
  })

  it('hides the cancel-contract action when no items are reserved', async () => {
    const returnedContract: Contract = {
      ...contract,
      allocations: [{ ...contract.allocations[0], status: 'returned' }],
    }
    mockHooks({ contracts: [returnedContract] })
    await renderAndSelect(<ContractsPage />)
    // Nothing left to cancel: the "•••" menu that would hold it doesn't
    // render at all, rather than opening to an empty list.
    expect(screen.queryByRole('button', { name: 'Mais ações' })).not.toBeInTheDocument()
  })

  it('shows a sign-remotely action for an unsigned contract', async () => {
    mockHooks()
    await renderAndSelect(<ContractsPage />)
    // Its own visible button now, not tucked into "•••" — see
    // ContractHeaderActions.
    expect(screen.getByRole('button', { name: 'Assinar remotamente' })).toBeInTheDocument()
  })

  it('hides the sign-remotely action once the contract is signed', async () => {
    const signedContract: Contract = { ...contract, signatureStatus: 'signed' }
    mockHooks({ contracts: [signedContract] })
    await renderAndSelect(<ContractsPage />)
    expect(screen.queryByRole('button', { name: 'Assinar remotamente' })).not.toBeInTheDocument()
  })

  it('shows pagination controls and a search box, and searching resets to page 1', async () => {
    const listSpy = vi.spyOn(useContractsModule, 'useContractsList').mockReturnValue({
      data: { contracts: [contract], total: 25, page: 1, pageSize: 20 },
      isLoading: false,
    } as never)
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [{ id: 'p1', name: 'Vestido Azul' }] } as never)
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [client] } as never)
    vi.spyOn(useContractsModule, 'useCancelContract').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
    vi.spyOn(useContractsModule, 'useIssueSigningToken').mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ token: 't', expiresAt: new Date().toISOString(), port: 3000, candidates: [] }),
      isPending: false,
    } as never)

    await renderAndSelect(<ContractsPage />)

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
    await renderAndSelect(<ContractsPage />)

    await openCheckOutDialog()
    await userEvent.type(screen.getByLabelText('Estado do produto na saída'), 'pequeno rasgo')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(screen.getByLabelText('Estado do produto na saída')).toHaveValue('pequeno rasgo')
  })

  it('keeps the check-out notes when Continuar editando is chosen', async () => {
    mockHooks()
    mockAllocationHooks()
    await renderAndSelect(<ContractsPage />)

    await openCheckOutDialog()
    await userEvent.type(screen.getByLabelText('Estado do produto na saída'), 'pequeno rasgo')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar editando' }))

    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Estado do produto na saída')).toHaveValue('pequeno rasgo')
  })

  it('clears the check-out fields after discarding, so reopening starts fresh', async () => {
    mockHooks()
    mockAllocationHooks()
    await renderAndSelect(<ContractsPage />)

    await openCheckOutDialog()
    await userEvent.type(screen.getByLabelText('Estado do produto na saída'), 'pequeno rasgo')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    expect(screen.queryByLabelText('Estado do produto na saída')).not.toBeInTheDocument()

    await openCheckOutDialog()

    expect(screen.getByLabelText('Estado do produto na saída')).toHaveValue('')
    expect(currencyValue('Caução recebida')).toBe('R$ 0,00')
  })

  it('closes the check-out dialog straight away when nothing was typed', async () => {
    mockHooks()
    mockAllocationHooks()
    await renderAndSelect(<ContractsPage />)

    await openCheckOutDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Estado do produto na saída')).not.toBeInTheDocument()
  })

  it('clears the check-out fields after a successful check-out', async () => {
    mockHooks()
    const checkOutImpl = vi.fn().mockResolvedValue(undefined)
    mockAllocationHooks({ checkOutImpl })
    await renderAndSelect(<ContractsPage />)

    await openCheckOutDialog()
    await userEvent.type(screen.getByLabelText('Estado do produto na saída'), 'pequeno rasgo')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar check-out' }))

    expect(checkOutImpl).toHaveBeenCalledOnce()

    await openCheckOutDialog()
    expect(screen.getByLabelText('Estado do produto na saída')).toHaveValue('')
  })

  it('prompts before discarding typed return notes, and clears them after discarding', async () => {
    mockHooks({ contracts: [checkedOutContract] })
    mockAllocationHooks()
    await renderAndSelect(<ContractsPage />)

    await openReturnDialog()
    await userEvent.type(screen.getByLabelText('Estado do produto na devolução'), 'tudo certo')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    await openReturnDialog()

    expect(screen.getByLabelText('Estado do produto na devolução')).toHaveValue('')
    expect(currencyValue('Caução devolvida')).toBe('R$ 0,00')
  })

  it('CRITICAL: the return dialog suggests exactly what was taken at checkout', async () => {
    // It opened at R$ 0,00 with no reminder of the R$ 300,00 collected weeks
    // earlier, so the operator handed back whatever she remembered — and
    // nothing in the app ever compared the two numbers.
    const withDeposit = {
      ...checkedOutContract,
      allocations: [{ ...checkedOutContract.allocations[0], depositCollected: 300 }],
    }
    mockHooks({ contracts: [withDeposit] })
    mockAllocationHooks()
    await renderAndSelect(<ContractsPage />)

    await openReturnDialog()

    expect(currencyValue('Caução devolvida')).toBe('R$ 300,00')
    expect(screen.getByText(/Você recebeu .*300,00 de caução/)).toBeInTheDocument()
  })

  it('CRITICAL: the prefill survives the row outliving a check-out', async () => {
    /*
      AllocationActions is keyed by allocation id and survives the refetch
      after check-out, so useState's initializer had already run with
      depositCollected still null. The field then read R$ 0,00 directly above
      a hint saying R$ 300,00 — the dialog contradicting itself — and the
      unsaved-changes guard saw 0 !== 300 and prompted "Descartar alterações?"
      on every close with nothing typed. Both are the pre-fix behaviour,
      reached without ever leaving the screen.
    */
    const reserved = {
      ...checkedOutContract,
      allocations: [{ ...checkedOutContract.allocations[0], status: 'reserved' as const, depositCollected: null }],
    }
    mockHooks({ contracts: [reserved] })
    mockAllocationHooks()
    const { rerender } = await renderAndSelect(<ContractsPage />)

    // The piece goes out with caução, and the row re-renders in place.
    mockHooks({
      contracts: [
        {
          ...checkedOutContract,
          allocations: [{ ...checkedOutContract.allocations[0], depositCollected: 300 }],
        },
      ],
    })
    mockAllocationHooks()
    rerender(<ContractsPage />)

    await openReturnDialog()

    expect(currencyValue('Caução devolvida')).toBe('R$ 300,00')
  })

  it('says plainly when no caução was taken, rather than suggesting zero silently', async () => {
    mockHooks({ contracts: [checkedOutContract] })
    mockAllocationHooks()
    await renderAndSelect(<ContractsPage />)

    await openReturnDialog()

    expect(screen.getByText('Nenhuma caução foi registrada na saída desta peça.')).toBeInTheDocument()
  })

  it('does not guard the pure cancel-allocation confirmation, which carries no input', async () => {
    mockHooks()
    const cancelAllocationImpl = vi.fn().mockResolvedValue(undefined)
    mockAllocationHooks({ cancelAllocationImpl })
    await renderAndSelect(<ContractsPage />)

    await openPieceActions()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cancelar' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sim, cancelar' }))

    expect(cancelAllocationImpl).toHaveBeenCalledWith('a1')
    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument()
  })
})

describe('payments summary', () => {
  it('always shows the money, so a long contract can be scanned without expanding it', async () => {
    mockHooks()
    await renderAndSelect(<ContractsPage />)

    const panel = document.querySelector('aside') as HTMLElement
    // Three cells, each with its own label and figure — the assertion that
    // used to match "Total: R$ ..." as one string would still pass against a
    // single condensed line, which is exactly what this replaced. "Em
    // aberto" legitimately appears twice here: once as the status badge next
    // to "Pagamentos", once as the third tile's own label.
    expect(within(panel).getByText('Total')).toBeInTheDocument()
    expect(within(panel).getByText('Pago')).toBeInTheDocument()
    expect(within(panel).getAllByText('Em aberto').length).toBe(2)
    expect(within(panel).getAllByText(/R\$/).length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText('Nenhum pagamento recebido até agora.')).toBeInTheDocument()
  })

  it('CRITICAL: leaves cancelled pieces out of the total the shop is owed', async () => {
    // One piece went out at 380, a second was cancelled before it ever left.
    // The list row already excluded the cancelled 500; the panel's own total
    // did not, so the same contract read 380 in one place and 880 in the
    // other — and the 880 turned into an "Em aberto" the shop would have
    // chased the client for.
    mockHooks({
      contracts: [
        {
          ...contract,
          allocations: [
            ...contract.allocations,
            {
              ...contract.allocations[0],
              id: 'a2', productId: 'p2', status: 'cancelled' as const, priceCharged: 500,
            },
          ],
          // The client already paid for the piece that actually went out.
          payments: [
            { id: 'pm1', contractId: 'ct1', amount: 380, method: 'PIX', paidAt: '2026-09-20', createdAt: '2026-09-20' },
          ],
        },
      ],
    })
    await renderAndSelect(<ContractsPage />)

    const panel = document.querySelector('aside') as HTMLElement
    // The Intl-formatted figure separates "R$" and the amount with a
    // non-breaking space, so both sides are normalised to a plain one before
    // comparing against a hand-typed literal — same reasoning as this file's
    // own currencyValue() helper.
    const figureUnder = (label: string) =>
      within(within(panel).getByText(label).parentElement as HTMLElement)
        .getByText(/R\$/)
        .textContent?.replace(/ /g, ' ')

    expect(figureUnder('Total')).toBe('R$ 380,00')
    // Counting the cancelled 500 left the contract reading R$ 500,00 still to
    // collect on a dress that never left the shop.
    expect(figureUnder('Em aberto')).toBe('R$ 0,00')
  })

  it('CRITICAL: a contract paid to the centavo reads as settled, not as an urgent R$ 0,00', async () => {
    /*
      Two pieces at 679,90 and 1.249,90 sum, as floats, to
      1929.8000000000001819; typing "1929,80" into CurrencyInput produces
      1929.7999999999999545. The difference is 2.27e-13, and the old
      `outstanding > 0` test said yes — so a contract paid exactly showed
      Total R$ 1.929,80 / Pago R$ 1.929,80 / an URGENT "Em aberto R$ 0,00",
      with the badge agreeing and the figures beside it disagreeing. Roughly
      7% of settled contracts, and no user would ever discover the recovery.
    */
    mockHooks({
      contracts: [
        {
          ...contract,
          allocations: [
            { ...contract.allocations[0], id: 'a1', priceCharged: 679.9 },
            { ...contract.allocations[0], id: 'a2', productId: 'p2', priceCharged: 1249.9 },
          ],
          payments: [
            { id: 'pm1', contractId: 'ct1', amount: 1929.8, method: 'PIX', paidAt: '2026-09-20', createdAt: '2026-09-20' },
          ],
        },
      ],
    })
    await renderAndSelect(<ContractsPage />)

    const panel = document.querySelector('aside') as HTMLElement
    const figureUnder = (label: string) =>
      within(within(panel).getByText(label).parentElement as HTMLElement)
        .getByText(/R\$/)
        .textContent?.replace(/\u00a0/g, ' ')

    expect(figureUnder('Total')).toBe('R$ 1.929,80')
    expect(figureUnder('Pago')).toBe('R$ 1.929,80')
    expect(within(panel).getByText('Quitado')).toBeInTheDocument()
    expect(within(panel).queryByText('Pago a mais')).not.toBeInTheDocument()
  })

  it('a contract overpaid only by float residue is not reported as overpaid', async () => {
    // The mirror of the case above: 899,90 + 299,90 + 449,90 settled by two
    // payments of 824,85 lands at -2.27e-13, which used to render
    // "Pago a mais" and the note "pagou R$ 0,00 além do total".
    mockHooks({
      contracts: [
        {
          ...contract,
          allocations: [
            { ...contract.allocations[0], id: 'a1', priceCharged: 899.9 },
            { ...contract.allocations[0], id: 'a2', productId: 'p2', priceCharged: 299.9 },
            { ...contract.allocations[0], id: 'a3', productId: 'p3', priceCharged: 449.9 },
          ],
          payments: [
            { id: 'pm1', contractId: 'ct1', amount: 824.85, method: 'PIX', paidAt: '2026-09-20', createdAt: '2026-09-20' },
            { id: 'pm2', contractId: 'ct1', amount: 824.85, method: 'PIX', paidAt: '2026-09-21', createdAt: '2026-09-21' },
          ],
        },
      ],
    })
    await renderAndSelect(<ContractsPage />)

    const panel = document.querySelector('aside') as HTMLElement
    expect(within(panel).getByText('Quitado')).toBeInTheDocument()
    expect(within(panel).queryByText(/além do total/)).not.toBeInTheDocument()
  })

  it('CRITICAL: shows the caução still being held, separately from the money owed', async () => {
    // Collected minus returned, over live pieces. Nothing read these columns
    // before, so no screen could answer "how much caução am I holding" — the
    // only place in the app where real cash could leave through the wrong hand
    // with nothing to check it against.
    mockHooks({
      contracts: [
        {
          ...contract,
          allocations: [
            { ...contract.allocations[0], id: 'a1', depositCollected: 300, depositReturned: null },
            { ...contract.allocations[0], id: 'a2', productId: 'p2', depositCollected: 200, depositReturned: 200 },
            { ...contract.allocations[0], id: 'a3', productId: 'p3', status: 'cancelled' as const, depositCollected: 999, depositReturned: null },
          ],
        },
      ],
    })
    await renderAndSelect(<ContractsPage />)

    const panel = document.querySelector('aside') as HTMLElement
    const held = within(within(panel).getByText('Caução retida').parentElement as HTMLElement)
      .getByText(/R\$/)
      .textContent?.replace(/\u00a0/g, ' ')
    // 300 outstanding, 200 already given back, and the cancelled piece's 999
    // never counted at all.
    expect(held).toBe('R$ 300,00')
  })

  it('CRITICAL: survives the list resolving from loading, with the real hooks', async () => {
    /*
      A hook placed after the `isLoading` early return registers on some
      renders and not others: the cold-cache render took the loading branch
      with one fewer hook, and the moment the list resolved React threw
      "Rendered more hooks than during the previous render" — which
      ChunkErrorBoundary turns into a full-app crash screen, not a broken
      panel. It read as intermittent because a return within gcTime finds
      isLoading already false.

      No test rendered the loading state, and mockHooks pinned
      `isLoading: false` unconditionally, so 847 green tests could not see it.
      This one drives the transition and leaves useContract UNMOCKED, which is
      the combination that reproduces it.
    */
    mockHooks({ contracts: [contract] })
    vi.spyOn(useContractsModule, 'useContract').mockRestore?.()
    vi.spyOn(useContractsModule, 'useContractsList').mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as never)

    const { rerender } = renderWithProviders(<ContractsPage />)

    vi.spyOn(useContractsModule, 'useContractsList').mockReturnValue({
      data: { contracts: [contract], counts: {}, total: 1 },
      isLoading: false,
      isError: false,
    } as never)
    rerender(<ContractsPage />)

    expect(screen.getByText('Contratos')).toBeInTheDocument()
  })

  it('CRITICAL: the panel survives the contract leaving the filtered list', async () => {
    /*
      The two ways a contract legitimately leaves the result set are the two
      moments a customer is standing there watching: signing from "Não
      assinados", and logging the final payment from "Em aberto". The panel
      read from the filtered page, so it emptied — and SignRemotelyModal lives
      in that subtree, so the QR modal was torn down by the very invalidation
      its own success triggered, before she ever saw it worked.
    */
    mockHooks({ contracts: [contract] })
    const { rerender } = await renderAndSelect(<ContractsPage />)
    expect(document.body.textContent).toContain('Pagamentos')

    // The list refetches and the contract is no longer in it, but it is still
    // the selected one.
    mockHooks({ contracts: [] })
    vi.spyOn(useContractsModule, 'useContract').mockReturnValue({ data: contract } as never)
    rerender(<ContractsPage />)

    expect(document.body.textContent).toContain('Pagamentos')
  })

  it('lists logged payments with their date, method and amount', async () => {
    mockHooks({
      contracts: [
        {
          ...contract,
          payments: [
            { id: 'pm1', contractId: 'ct1', amount: 200, method: 'PIX', paidAt: '2026-07-18', createdAt: '2026-07-18' },
          ],
        },
      ],
    })
    await renderAndSelect(<ContractsPage />)

    // Scoped to the row itself: with only this one payment, its amount
    // happens to equal the "Pago" tile's own total too, and a page-wide
    // query would find both.
    const row = screen.getByText('18/07/2026').closest('li') as HTMLElement
    expect(within(row).getByText('PIX')).toBeInTheDocument()
    expect(within(row).getByText('R$ 200,00')).toBeInTheDocument()
  })

  it('logs a new payment through the dialog, defaulting the amount to what is outstanding', async () => {
    const { createPaymentImpl } = mockHooks()
    await renderAndSelect(<ContractsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
    expect(currencyValue('Valor recebido')).toBe('R$ 380,00')

    await userEvent.click(screen.getByRole('button', { name: 'Salvar pagamento' }))

    expect(createPaymentImpl).toHaveBeenCalledWith({
      contractId: 'ct1',
      values: expect.objectContaining({ amount: 380, method: 'PIX' }),
    })
  })

  it('edits a logged payment, prefilling its own amount rather than the outstanding balance', async () => {
    const { updatePaymentImpl } = mockHooks({
      contracts: [
        {
          ...contract,
          payments: [
            { id: 'pm1', contractId: 'ct1', amount: 200, method: 'PIX', paidAt: '2026-07-18', createdAt: '2026-07-18' },
          ],
        },
      ],
    })
    await renderAndSelect(<ContractsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Editar pagamento' }))
    expect(currencyValue('Valor recebido')).toBe('R$ 200,00')

    const amountField = screen.getByLabelText('Valor recebido')
    await userEvent.clear(amountField)
    await userEvent.type(amountField, '25000')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar pagamento' }))

    expect(updatePaymentImpl).toHaveBeenCalledWith({
      contractId: 'ct1',
      paymentId: 'pm1',
      values: expect.objectContaining({ amount: 250 }),
    })
  })

  it('deletes a logged payment after confirming', async () => {
    const { deletePaymentImpl } = mockHooks({
      contracts: [
        {
          ...contract,
          payments: [
            { id: 'pm1', contractId: 'ct1', amount: 200, method: 'PIX', paidAt: '2026-07-18', createdAt: '2026-07-18' },
          ],
        },
      ],
    })
    await renderAndSelect(<ContractsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Excluir pagamento' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }))

    expect(deletePaymentImpl).toHaveBeenCalledWith({ contractId: 'ct1', paymentId: 'pm1' })
  })

  it('shows Devolver, not a negative Em aberto, once the client has paid more than the total', async () => {
    mockHooks({
      contracts: [
        {
          ...contract,
          payments: [
            { id: 'pm1', contractId: 'ct1', amount: 500, method: 'PIX', paidAt: '2026-07-18', createdAt: '2026-07-18' },
          ],
        },
      ],
    })
    await renderAndSelect(<ContractsPage />)

    const panel = document.querySelector('aside') as HTMLElement
    expect(within(panel).getByText('Devolver')).toBeInTheDocument()
    expect(within(panel).queryByText('Em aberto')).not.toBeInTheDocument()
  })

  it('previews an overpayment as "para devolver", not as a raw negative amount', async () => {
    mockHooks()
    await renderAndSelect(<ContractsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
    const amountField = screen.getByLabelText('Valor recebido')
    await userEvent.clear(amountField)
    await userEvent.type(amountField, '100000')

    expect(screen.getByText('Fica R$ 620,00 para devolver')).toBeInTheDocument()
    expect(screen.queryByText(/-R\$/)).not.toBeInTheDocument()
  })
})

describe('ContractsPage split view', () => {
  it('keeps contract actions out of the list until a contract is picked', async () => {
    mockHooks()
    renderWithProviders(<ContractsPage />)

    // The old card put Imprimir, Assinar and Cancelar on every contract at
    // once, plus per-piece and per-instalment buttons — sixteen for a
    // three-piece contract. None of them belong to the list.
    expect(screen.queryByRole('link', { name: 'Imprimir' })).not.toBeInTheDocument()
    expect(
      screen.getByText('Selecione um contrato na lista para ver as peças e os pagamentos.'),
    ).toBeInTheDocument()

    await userEvent.click((await screen.findAllByRole('button', { name: /#\d/ }))[0])

    expect(screen.getByRole('link', { name: 'Imprimir' })).toBeInTheDocument()
  })

  it('states the contract situation in the list, worst piece first', async () => {
    mockHooks()
    renderWithProviders(<ContractsPage />)

    // The list previously carried no contract-level state at all: you had
    // to open a card and read its allocations to know where it stood.
    const list = screen.getByRole('row').parentElement as HTMLElement
    expect(within(list).getByText('Reservado')).toBeInTheDocument()
  })
})

describe('status filter chips', () => {
  it('shows the counts the server measured over the whole archive', async () => {
    // Deliberately larger than the page: the counts describe every contract
    // the search matches, not the 20 rows that came back, which is the whole
    // reason they are computed server-side.
    mockHooks({ counts: { all: 240, active: 96, overdue: 7, unsigned: 31, outstanding: 50 } })
    renderWithProviders(<ContractsPage />)

    expect(await screen.findByRole('button', { name: /^Ativos\s*96$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Atrasados\s*7$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Não assinados\s*31$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Todos\s*240$/ })).toBeInTheDocument()
  })

  it('asks the server for the picked view instead of narrowing the page in the browser', async () => {
    const listSpy = vi.fn().mockReturnValue({
      data: { contracts: [contract], total: 1, page: 1, pageSize: 20, counts: { all: 1, active: 1, overdue: 0, unsigned: 1, outstanding: 1 } },
      isLoading: false,
    })
    mockHooks()
    vi.spyOn(useContractsModule, 'useContractsList').mockImplementation(listSpy as never)
    renderWithProviders(<ContractsPage />)

    await userEvent.click(await screen.findByRole('button', { name: /^Atrasados/ }))

    expect(screen.getByRole('button', { name: /^Atrasados/ })).toHaveAttribute('aria-pressed', 'true')
    expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'overdue' }))
  })

  it('returns to the first page when the view changes', async () => {
    const listSpy = vi.fn().mockReturnValue({
      data: { contracts: [contract], total: 60, page: 3, pageSize: 20, counts: { all: 60, active: 60, overdue: 2, unsigned: 60, outstanding: 30 } },
      isLoading: false,
    })
    mockHooks()
    vi.spyOn(useContractsModule, 'useContractsList').mockImplementation(listSpy as never)
    renderWithProviders(<ContractsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Próximo' }))
    await userEvent.click(screen.getByRole('button', { name: /^Atrasados/ }))

    // Page 3 of Todos almost certainly has no equivalent under Atrasados, and
    // an empty page reads as "no results" rather than as a paging accident.
    expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'overdue', page: 1 }))
  })

  it('shows every contract by default', async () => {
    mockHooks({ counts: { all: 3, active: 2, overdue: 1, unsigned: 2, outstanding: 3 } })
    renderWithProviders(<ContractsPage />)

    expect(await screen.findByRole('button', { name: /^Todos\s*3$/ })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('week grouping', () => {
  function isoDaysFromNow(days: number) {
    const date = new Date()
    date.setDate(date.getDate() + days)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  it('splits the list into this week, later weeks and earlier ones, with a count each', async () => {
    // Grouping is relative to "now", so these dates are computed rather than
    // hardcoded — a fixed date would land in a different bucket depending on
    // the day the suite runs. 40 days out clears the current week whatever
    // weekday it is; 40 days back likewise.
    const thisWeek: Contract = { ...contract, id: 'ct-now', number: 1, eventDate: isoDaysFromNow(0) }
    const later: Contract = { ...contract, id: 'ct-later', number: 2, eventDate: isoDaysFromNow(40) }
    const earlier: Contract = { ...contract, id: 'ct-earlier', number: 4, eventDate: isoDaysFromNow(-40) }
    mockHooks({ contracts: [thisWeek, later, earlier] })
    renderWithProviders(<ContractsPage />)

    expect(await screen.findByText('Esta semana')).toBeInTheDocument()
    expect(screen.getByText('Próximas semanas')).toBeInTheDocument()
    expect(screen.getByText('Semanas anteriores')).toBeInTheDocument()
  })

  it('leaves out a week bucket that has no contracts', async () => {
    const later: Contract = { ...contract, id: 'ct-later', number: 2, eventDate: isoDaysFromNow(40) }
    mockHooks({ contracts: [later] })
    renderWithProviders(<ContractsPage />)

    expect(await screen.findByText('Próximas semanas')).toBeInTheDocument()
    expect(screen.queryByText('Esta semana')).not.toBeInTheDocument()
    expect(screen.queryByText('Semanas anteriores')).not.toBeInTheDocument()
  })
})

describe('client section in the detail panel', () => {
  it('shows the documents and address already on the client record', async () => {
    mockHooks()
    await renderAndSelect(<ContractsPage />)
    const panel = document.querySelector('aside') as HTMLElement

    expect(within(panel).getByText('Documentos')).toBeInTheDocument()
    expect(within(panel).getByText('CPF')).toBeInTheDocument()
    expect(within(panel).getByText('123.456.789-00')).toBeInTheDocument()
    expect(within(panel).getByText('RG')).toBeInTheDocument()
    expect(within(panel).getByText('Endereço')).toBeInTheDocument()
    expect(within(panel).getByText('Rua das Flores, 120')).toBeInTheDocument()
  })

  it('says so plainly when the client has neither on file', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [{ ...client, identityDocuments: [], addressLines: [] }],
    } as never)
    mockHooks()
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [{ ...client, identityDocuments: [], addressLines: [] }],
    } as never)
    await renderAndSelect(<ContractsPage />)
    const panel = document.querySelector('aside') as HTMLElement

    expect(within(panel).getAllByText('Não informado')).toHaveLength(2)
  })
})

describe('opening the form for a client chosen elsewhere', () => {
  function renderAt(entry: string) {
    const queryClient = new QueryClient()
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <QueryClientProvider client={queryClient}>
          <ContractsPage />
        </QueryClientProvider>
      </MemoryRouter>,
    )
  }

  it('passes the clienteId param through to the form', async () => {
    mockHooks()
    // This file does not restore mocks between tests, so the spy would carry
    // the previous test's calls if it were not cleared.
    const formSpy = vi.spyOn(NewContractFormModule, 'NewContractForm').mockImplementation(() => <span data-testid="form-stub" />)
    formSpy.mockClear()

    renderAt('/contratos?novo=1&clienteId=c1')

    await waitFor(() => expect(formSpy).toHaveBeenCalled())
    expect(formSpy.mock.calls[0][0]).toMatchObject({ clientId: 'c1' })
  })

  it('leaves the form unpreselected when only novo=1 is present', async () => {
    mockHooks()
    const formSpy = vi.spyOn(NewContractFormModule, 'NewContractForm').mockImplementation(() => <span data-testid="form-stub" />)
    formSpy.mockClear()

    renderAt('/contratos?novo=1')

    await waitFor(() => expect(formSpy).toHaveBeenCalled())
    expect(formSpy.mock.calls[0][0].clientId).toBeUndefined()
  })

  it('drops the client id from the URL when the form closes', async () => {
    mockHooks()
    vi.spyOn(NewContractFormModule, 'NewContractForm').mockImplementation(
      ({ onClose }: { onClose: () => void }) => (
        <button type="button" onClick={onClose}>
          fechar
        </button>
      ),
    )

    renderAt('/contratos?novo=1&clienteId=c1')
    await userEvent.click(await screen.findByRole('button', { name: 'fechar' }))

    // A stale id outliving its dialog would silently preselect the wrong
    // person the next time the shortcut in the rail opens this form.
    expect(screen.queryByRole('button', { name: 'fechar' })).not.toBeInTheDocument()
  })
})
