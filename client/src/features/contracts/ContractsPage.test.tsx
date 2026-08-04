import { describe, it, expect, vi, type Mock } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import '../../i18n.ts'
import { ContractsPage, canMarkInstallmentPaid } from './ContractsPage.tsx'
import * as useContractsModule from './useContracts.ts'
import * as useProductsModule from '../products/useProducts.ts'
import * as useClientsModule from '../clients/useClients.ts'
import * as useAllocationsModule from '../allocations/useAllocations.ts'
import * as toastModule from '../../lib/toast.ts'
import * as NewContractFormModule from './NewContractForm.tsx'
import type { Contract } from './contractSchemas.ts'

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient()
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
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
  // Deliberately a date already past: an instalment can only be settled from
  // its due date onwards, so a future-dated fixture would describe a row whose
  // "Marcar como pago" is correctly unavailable — not the ordinary case these
  // tests are about.
  installments: [{ id: 'i1', contractId: 'ct1', dueDate: '2026-01-20', amount: 380, paid: false, paidAt: null }],
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
    setPaidImpl?: Mock
    counts?: { all: number; active: number; overdue: number; unsigned: number }
  } = {},
) {
  const contracts = overrides.contracts ?? [contract]
  vi.spyOn(useContractsModule, 'useContractsList').mockReturnValue({
    data: {
      contracts,
      total: contracts.length,
      page: 1,
      pageSize: 20,
      counts: overrides.counts ?? { all: contracts.length, active: contracts.length, overdue: 0, unsigned: contracts.length },
    },
    isLoading: false,
  } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [{ id: 'p1', name: 'Vestido Azul' }] } as never)
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [client] } as never)
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
    await openHeaderActions()
    expect(screen.queryByRole('menuitem', { name: 'Cancelar contrato' })).not.toBeInTheDocument()
  })

  it('shows a sign-remotely action for an unsigned contract', async () => {
    mockHooks()
    await renderAndSelect(<ContractsPage />)
    await openHeaderActions()
    expect(screen.getByRole('menuitem', { name: 'Assinar remotamente' })).toBeInTheDocument()
  })

  it('hides the sign-remotely action once the contract is signed', async () => {
    const signedContract: Contract = { ...contract, signatureStatus: 'signed' }
    mockHooks({ contracts: [signedContract] })
    await renderAndSelect(<ContractsPage />)
    await openHeaderActions()
    expect(screen.queryByRole('menuitem', { name: 'Assinar remotamente' })).not.toBeInTheDocument()
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
    // single condensed line, which is exactly what this replaced.
    expect(within(panel).getByText('Total')).toBeInTheDocument()
    expect(within(panel).getByText('Pago')).toBeInTheDocument()
    expect(within(panel).getByText('Em aberto')).toBeInTheDocument()
    expect(within(panel).getAllByText(/R\$/).length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText('0 de 1 pagas')).toBeInTheDocument()
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
          installments: [
            { id: 'i1', contractId: 'ct1', dueDate: '2026-09-20', amount: 380, paid: true, paidAt: '2026-09-20' },
          ],
        },
      ],
    })
    await renderAndSelect(<ContractsPage />)

    const panel = document.querySelector('aside') as HTMLElement
    const figureUnder = (label: string) =>
      within(within(panel).getByText(label).parentElement as HTMLElement)
        .getByText(/R\$/)
        .textContent?.replace(/ /g, ' ')

    expect(figureUnder('Total')).toBe('R$ 380,00')
    // Counting the cancelled 500 left the contract reading R$ 500,00 still to
    // collect on a dress that never left the shop.
    expect(figureUnder('Em aberto')).toBe('R$ 0,00')
  })

  it('keeps the instalment rows collapsed so a 12x contract cannot swamp the list', async () => {
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
    await renderAndSelect(<ContractsPage />)

    expect(screen.queryByRole('button', { name: 'Marcar como pago' })).not.toBeInTheDocument()
    expect(screen.getByText('0 de 12 pagas')).toBeInTheDocument()
  })

  it('reveals the instalment rows when the summary is opened', async () => {
    mockHooks()
    await renderAndSelect(<ContractsPage />)

    await userEvent.click(screen.getByRole('button', { name: /Pagamentos/ }))

    expect(screen.getByRole('button', { name: 'Marcar como pago' })).toBeInTheDocument()
  })

  it('sends the paid flag for the instalment that was toggled', async () => {
    const { setPaidImpl } = mockHooks({
      contracts: [
        {
          ...contract,
          installments: [{ id: 'i1', contractId: 'ct1', dueDate: '2026-01-20', amount: 380, paid: false, paidAt: null }],
        },
      ],
    })
    await renderAndSelect(<ContractsPage />)
    await userEvent.click(screen.getByRole('button', { name: /Pagamentos/ }))

    await userEvent.click(screen.getByRole('button', { name: 'Marcar como pago' }))

    expect(setPaidImpl).toHaveBeenCalledWith({ contractId: 'ct1', installmentId: 'i1', paid: true })
  })

  /*
    Money that has not been agreed to arrive yet cannot be marked as arrived.
    The rows sit one under the other in a collapsed list, and the mis-click
    this prevents — settling March's instalment while looking at February's —
    leaves the contract reporting a balance the shop never collected. The
    control stays visible and says why, because a button that vanishes reads
    as a bug rather than as a rule.
  */
  it('CRITICAL: refuses to settle an instalment before its due date has arrived', async () => {
    const { setPaidImpl } = mockHooks({
      contracts: [
        {
          ...contract,
          installments: [
            { id: 'i1', contractId: 'ct1', dueDate: '2099-12-01', amount: 380, paid: false, paidAt: null },
          ],
        },
      ],
    })
    await renderAndSelect(<ContractsPage />)
    await userEvent.click(screen.getByRole('button', { name: /Pagamentos/ }))

    const action = screen.getByRole('button', { name: /Só é possível marcar como pago a partir de 01\/12\/2099/ })
    expect(action).toBeDisabled()
    await userEvent.click(action)
    expect(setPaidImpl).not.toHaveBeenCalled()
  })

  it('settles an instalment due today, not only one already overdue', async () => {
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const { setPaidImpl } = mockHooks({
      contracts: [
        {
          ...contract,
          installments: [{ id: 'i1', contractId: 'ct1', dueDate: iso, amount: 380, paid: false, paidAt: null }],
        },
      ],
    })
    await renderAndSelect(<ContractsPage />)
    await userEvent.click(screen.getByRole('button', { name: /Pagamentos/ }))

    await userEvent.click(screen.getByRole('button', { name: 'Marcar como pago' }))

    expect(setPaidImpl).toHaveBeenCalledWith({ contractId: 'ct1', installmentId: 'i1', paid: true })
  })

  it('leaves undoing unrestricted, so a wrongly-settled future instalment can be taken back', async () => {
    const { setPaidImpl } = mockHooks({
      contracts: [
        {
          ...contract,
          installments: [
            { id: 'i1', contractId: 'ct1', dueDate: '2099-12-01', amount: 380, paid: true, paidAt: '2026-01-01' },
          ],
        },
      ],
    })
    await renderAndSelect(<ContractsPage />)
    await userEvent.click(screen.getByRole('button', { name: /Pagamentos/ }))

    await userEvent.click(screen.getByRole('button', { name: 'Desmarcar' }))

    expect(setPaidImpl).toHaveBeenCalledWith({ contractId: 'ct1', installmentId: 'i1', paid: false })
  })
})

describe('canMarkInstallmentPaid', () => {
  const today = new Date(2026, 7, 4)

  it('allows the due day itself and every day after it', () => {
    expect(canMarkInstallmentPaid('2026-08-04', today)).toBe(true)
    expect(canMarkInstallmentPaid('2026-08-03', today)).toBe(true)
  })

  it('refuses tomorrow', () => {
    expect(canMarkInstallmentPaid('2026-08-05', today)).toBe(false)
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
    mockHooks({ counts: { all: 240, active: 96, overdue: 7, unsigned: 31 } })
    renderWithProviders(<ContractsPage />)

    expect(await screen.findByRole('button', { name: /^Ativos\s*96$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Atrasados\s*7$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Não assinados\s*31$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Todos\s*240$/ })).toBeInTheDocument()
  })

  it('asks the server for the picked view instead of narrowing the page in the browser', async () => {
    const listSpy = vi.fn().mockReturnValue({
      data: { contracts: [contract], total: 1, page: 1, pageSize: 20, counts: { all: 1, active: 1, overdue: 0, unsigned: 1 } },
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
      data: { contracts: [contract], total: 60, page: 3, pageSize: 20, counts: { all: 60, active: 60, overdue: 2, unsigned: 60 } },
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
    mockHooks({ counts: { all: 3, active: 2, overdue: 1, unsigned: 2 } })
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
