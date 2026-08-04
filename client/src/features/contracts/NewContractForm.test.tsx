import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../i18n.ts'
import { NewContractForm } from './NewContractForm.tsx'
import * as useClientsModule from '../clients/useClients.ts'
import * as useProductsModule from '../products/useProducts.ts'
import * as useAllocationsModule from '../allocations/useAllocations.ts'
import * as useContractsModule from './useContracts.ts'
import * as useAuthModule from '../../lib/useAuth.ts'
import * as apiModule from '../../lib/api.ts'
import { Toaster } from '../../components/ui/sonner.tsx'
import type { Client } from '../clients/clientSchemas.ts'

const readyClient: Client = {
  id: 'c1', name: 'Maria Completa', phone: '11999999999', email: 'm@example.com', notes: '',
  identityDocuments: [
    { id: 'd1', label: 'CPF', value: '123.456.789-00', maskKey: 'br-cpf' },
    { id: 'd2', label: 'RG', value: '12.345.678-9', maskKey: 'br-rg' },
  ],
  addressLines: [
    { id: 'a1', label: 'Endereço', value: 'Rua X, 1', sortOrder: 0, maskKey: null },
    { id: 'a2', label: 'Bairro', value: 'Centro', sortOrder: 1, maskKey: null },
    { id: 'a3', label: 'Cidade', value: 'Piedade', sortOrder: 2, maskKey: null },
    { id: 'a4', label: 'Estado', value: 'SP', sortOrder: 3, maskKey: null },
  ],
  hasAllocationHistory: false, createdAt: '2026-01-01',
}

const incompleteClient: Client = {
  id: 'c2', name: 'Joana Incompleta', phone: '11988888888', email: 'j@example.com', notes: '',
  identityDocuments: [], addressLines: [], hasAllocationHistory: false, createdAt: '2026-01-01',
}

const product = {
  id: 'p1', locationId: 'loc1', name: 'Vestido Azul', description: '', category: 'festa', size: 'M',
  color: 'azul', rentalPrice: 100, depositAmount: 50, photos: [], status: 'active' as const,
  createdAt: '2026-01-01', availability: 'available' as const, hasAllocationHistory: false,
}

function renderWithToast(ui: React.ReactElement, queryClient: QueryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <>{ui}<Toaster /></>
    </QueryClientProvider>,
  )
}

// Hooks every test needs mocked regardless of which entity (client/product)
// it exercises for real.
function mockCommonHooks() {
  vi.spyOn(useAllocationsModule, 'useProductAvailability').mockReturnValue({ data: { available: true } } as never)
  vi.spyOn(useContractsModule, 'useCreateContract').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
  vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
    staff: { id: 's1', name: 'Staff', role: 'staff', locationId: 'l1', locationName: 'Loja', locale: 'pt-BR' },
    isLoadingStaff: false,
    login: vi.fn(),
    logout: vi.fn(),
    isLoggedIn: true,
  } as never)
}

function mockHooks() {
  mockCommonHooks()
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [readyClient, incompleteClient] } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product] } as never)
}

async function pickClient(name: RegExp) {
  await userEvent.click(screen.getByLabelText(/cliente/i))
  await userEvent.click(await screen.findByRole('option', { name }))
}

async function pickProduct(name: RegExp) {
  await userEvent.click(screen.getByLabelText(/produto/i))
  await userEvent.click(await screen.findByRole('option', { name }))
}

// Every test re-establishes exactly the mocks it needs (via mockHooks() or
// mockCommonHooks()); without this, a vi.spyOn from an earlier test leaks
// into a later one — most importantly the two "inline ... creation" suites
// below, which deliberately leave useClients/useCreateClient (resp.
// useProducts/useCreateProduct) unmocked to exercise the real hooks.
afterEach(() => {
  vi.restoreAllMocks()
})

describe('NewContractForm', () => {
  it('shows no missing-fields warning for a client with every required field filled', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await pickClient(/Maria Completa/)
    expect(screen.queryByText(/CPF, RG/)).not.toBeInTheDocument()
  })

  it('shows a missing-fields warning with a completion button for an incomplete client', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await pickClient(/Joana Incompleta/)
    expect(screen.getByRole('button', { name: /completar cadastro/i })).toBeInTheDocument()
  })

  it('opens ClientDrawer for the selected client when "complete registration" is clicked', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await pickClient(/Joana Incompleta/)
    await userEvent.click(screen.getByRole('button', { name: /completar cadastro/i }))
    expect(screen.getByLabelText(/nome/i)).toHaveValue('Joana Incompleta')
  })

  it('closes immediately when Cancelar is clicked on an untouched form', async () => {
    mockHooks()
    const onClose = vi.fn()
    renderWithToast(<NewContractForm onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('prompts before discarding a partially filled contract', async () => {
    mockHooks()
    const onClose = vi.fn()
    renderWithToast(<NewContractForm onClose={onClose} />)

    await pickClient(/Maria Completa/)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes after confirming Descartar', async () => {
    mockHooks()
    const onClose = vi.fn()
    renderWithToast(<NewContractForm onClose={onClose} />)

    await pickClient(/Maria Completa/)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('prompts instead of closing when the backdrop is clicked with a partially filled contract', async () => {
    mockHooks()
    const onClose = vi.fn()
    renderWithToast(<NewContractForm onClose={onClose} />)

    await pickClient(/Maria Completa/)
    await userEvent.click(document.querySelector('[data-slot="dialog-overlay"]')!)

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not prompt on the contract form when the nested client drawer is closed', async () => {
    mockHooks()
    const onClose = vi.fn()
    renderWithToast(<NewContractForm onClose={onClose} />)

    await pickClient(/Joana Incompleta/)
    await userEvent.click(screen.getByRole('button', { name: /completar cadastro/i }))
    expect(screen.getByRole('dialog', { name: 'Editar cliente' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Editar cliente' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Novo Contrato' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('lets staff add a second line item', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /adicionar peça/i }))
    expect(screen.getAllByLabelText(/produto/i)).toHaveLength(2)
  })

  it('lets staff remove a line item', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /adicionar peça/i }))
    const removeButtons = screen.getAllByRole('button', { name: /remover peça/i })
    await userEvent.click(removeButtons[0])
    expect(screen.getAllByLabelText(/produto/i)).toHaveLength(1)
  })

  it('lets staff add and remove installment rows', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /adicionar parcela/i }))
    expect(screen.getAllByLabelText(/valor da parcela/i)).toHaveLength(1)
    const removeButtons = screen.getAllByRole('button', { name: /remover parcela/i })
    await userEvent.click(removeButtons[0])
    expect(screen.queryAllByLabelText(/valor da parcela/i)).toHaveLength(0)
  })

  it('submits the full payload including payment method and installments', async () => {
    const createImpl = vi.fn().mockResolvedValue(undefined)
    mockHooks()
    vi.spyOn(useContractsModule, 'useCreateContract').mockReturnValue({ mutateAsync: createImpl, isPending: false } as never)
    const onClose = vi.fn()
    renderWithToast(<NewContractForm onClose={onClose} />)

    await pickClient(/Maria Completa/)
    await userEvent.type(screen.getByLabelText(/data do evento/i), '03102026')
    await pickProduct(/Vestido Azul/)
    await userEvent.type(screen.getByLabelText(/retirada/i), '02102026')
    await userEvent.type(screen.getByLabelText(/devolução/i), '05102026')
    await userEvent.selectOptions(screen.getByLabelText(/forma de pagamento/i), 'PIX')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }))

    expect(createImpl).toHaveBeenCalledOnce()
    expect(createImpl.mock.calls[0][0].paymentMethod).toBe('PIX')
    expect(createImpl.mock.calls[0][0].clientId).toBe('c1')
    expect(createImpl.mock.calls[0][0].locationId).toBeUndefined()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('asks for confirmation instead of saving immediately when the client is missing required fields', async () => {
    const createImpl = vi.fn().mockResolvedValue(undefined)
    mockHooks()
    vi.spyOn(useContractsModule, 'useCreateContract').mockReturnValue({ mutateAsync: createImpl, isPending: false } as never)
    renderWithToast(<NewContractForm onClose={vi.fn()} />)

    await pickClient(/Joana Incompleta/)
    await userEvent.type(screen.getByLabelText(/data do evento/i), '03102026')
    await pickProduct(/Vestido Azul/)
    await userEvent.type(screen.getByLabelText(/retirada/i), '02102026')
    await userEvent.type(screen.getByLabelText(/devolução/i), '05102026')
    await userEvent.selectOptions(screen.getByLabelText(/forma de pagamento/i), 'PIX')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }))

    expect(createImpl).not.toHaveBeenCalled()
    expect(screen.getByText(/salvar contrato mesmo assim/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /salvar mesmo assim/i }))

    expect(createImpl).toHaveBeenCalledOnce()
    expect(createImpl.mock.calls[0][0].clientId).toBe('c2')
  })

  it('shows a visible error on the product field when submitting without picking a product', async () => {
    const createImpl = vi.fn().mockResolvedValue(undefined)
    mockHooks()
    vi.spyOn(useContractsModule, 'useCreateContract').mockReturnValue({ mutateAsync: createImpl, isPending: false } as never)
    renderWithToast(<NewContractForm onClose={vi.fn()} />)

    await pickClient(/Maria Completa/)
    await userEvent.type(screen.getByLabelText(/data do evento/i), '03102026')
    await userEvent.type(screen.getByLabelText(/retirada/i), '02102026')
    await userEvent.type(screen.getByLabelText(/devolução/i), '05102026')
    await userEvent.selectOptions(screen.getByLabelText(/forma de pagamento/i), 'PIX')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }))

    expect(createImpl).not.toHaveBeenCalled()
    expect(screen.getByText('Produto é obrigatório')).toBeInTheDocument()
    expect(screen.getByLabelText(/produto/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it('focuses the client combobox, not some unrelated field, when submitting a completely empty form', async () => {
    const createImpl = vi.fn().mockResolvedValue(undefined)
    mockHooks()
    vi.spyOn(useContractsModule, 'useCreateContract').mockReturnValue({ mutateAsync: createImpl, isPending: false } as never)
    renderWithToast(<NewContractForm onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }))

    // RHF's shouldFocusError walks mounted fields for a focusable ref and
    // stops at the first invalid one — clientId is declared before
    // paymentMethod in the schema, so a Controller-driven combobox that
    // never forwards field.ref to a real DOM node would get skipped
    // entirely, silently landing focus on whatever registered field happens
    // to come last instead of the actual first error.
    expect(createImpl).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/cliente/i)).toHaveFocus()
  })
})

// These two suites deliberately do NOT mock useClients/useCreateClient (resp.
// useProducts/useCreateProduct) — everything else in this file replaces the
// whole hook so it never touches the query cache. Doing that here too would
// make the assertion below pass for the wrong reason: a fully-mocked
// useCreateClient can resolve with the new client, but the combobox reads its
// display label from `rows`, which is `clients` from useClients() — a static
// mock never includes the client that was "just created". The real feature
// only works because useCreateClient's onSuccess seeds the shared query-cache
// entry that useClients() reads (see useClients.ts/useProducts.ts), so these
// two tests run the real hooks against a mocked apiFetch (the pattern already
// used in useAllocations.test.tsx) to actually exercise that cache-seeding
// path instead of assuming it works.
describe('inline client creation', () => {
  it('creates a client from the typed name and selects it, arming the unsaved-changes guard', async () => {
    mockCommonHooks()
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product] } as never)
    const onClose = vi.fn()
    const created: Client = {
      id: 'c-new', name: 'Cliente Novo', phone: '11999990000', email: '', notes: '',
      identityDocuments: [], addressLines: [], hasAllocationHistory: false, createdAt: '2026-07-31',
    }
    let serverClients: Client[] = [readyClient, incompleteClient]
    const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockImplementation((async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      if (path === '/api/clients' && method === 'GET') return serverClients
      if (path === '/api/clients' && method === 'POST') {
        serverClients = [created, ...serverClients]
        return created
      }
      throw new Error(`unexpected apiFetch call in test: ${method} ${path}`)
    }) as never)

    const queryClient = new QueryClient()
    queryClient.setQueryData(useClientsModule.CLIENTS_KEY, serverClients)
    renderWithToast(<NewContractForm onClose={onClose} />, queryClient)

    await userEvent.click(screen.getByLabelText(/cliente/i))
    await userEvent.type(screen.getByRole('searchbox'), 'Cliente Novo')
    await userEvent.click(screen.getByRole('option', { name: /Criar cliente "Cliente Novo"/ }))

    expect(screen.getByRole('dialog', { name: 'Novo cliente' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toHaveValue('Cliente Novo')

    await userEvent.type(screen.getByLabelText('Telefone'), '11999990000')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    const postCalls = apiFetchSpy.mock.calls.filter(([path, init]) => path === '/api/clients' && (init as RequestInit | undefined)?.method === 'POST')
    expect(postCalls).toHaveLength(1)
    expect(await screen.findByLabelText(/cliente/i)).toHaveTextContent('Cliente Novo')
    expect(screen.queryByRole('dialog', { name: 'Novo cliente' })).not.toBeInTheDocument()

    // The just-created client has no CPF/RG/address on file — the readiness
    // gate this feature exists to protect must still catch that.
    expect(screen.getByRole('button', { name: /completar cadastro/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('inline product creation', () => {
  it('creates a product from the typed name, selects it in the item row, and fills its price', async () => {
    mockCommonHooks()
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [readyClient, incompleteClient] } as never)
    const created = {
      id: 'p-new', locationId: 'l1', name: 'Vestido Novo', description: '', category: 'festa', size: 'G', color: 'rosa',
      rentalPrice: 250, depositAmount: 0, photos: [], status: 'active' as const, availability: 'available' as const,
      hasAllocationHistory: false, createdAt: '2026-07-31',
    }
    let serverProducts: (typeof product)[] = [product]
    const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockImplementation((async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      if (path === '/api/products' && method === 'GET') return serverProducts
      if (path === '/api/products' && method === 'POST') {
        serverProducts = [created, ...serverProducts]
        return created
      }
      throw new Error(`unexpected apiFetch call in test: ${method} ${path}`)
    }) as never)

    const queryClient = new QueryClient()
    queryClient.setQueryData(useProductsModule.PRODUCTS_KEY, serverProducts)
    renderWithToast(<NewContractForm onClose={vi.fn()} />, queryClient)

    await userEvent.click(screen.getByLabelText(/produto/i))
    await userEvent.type(screen.getByRole('searchbox'), 'Vestido Novo')
    await userEvent.click(screen.getByRole('option', { name: /Criar produto "Vestido Novo"/ }))

    expect(screen.getByRole('dialog', { name: 'Novo produto' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toHaveValue('Vestido Novo')
    expect(screen.queryByLabelText('Salvar e adicionar outro')).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Categoria'), 'festa')
    await userEvent.type(screen.getByLabelText('Tamanho'), 'G')
    await userEvent.type(screen.getByLabelText('Cor'), 'rosa')
    await userEvent.clear(screen.getByLabelText('Preço do aluguel'))
    await userEvent.type(screen.getByLabelText('Preço do aluguel'), '25000')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    const postCalls = apiFetchSpy.mock.calls.filter(([path, init]) => path === '/api/products' && (init as RequestInit | undefined)?.method === 'POST')
    expect(postCalls).toHaveLength(1)
    expect(await screen.findByLabelText(/produto/i)).toHaveTextContent('Vestido Novo')
    expect(screen.queryByRole('dialog', { name: 'Novo produto' })).not.toBeInTheDocument()
    expect((screen.getByLabelText(/valor/i) as HTMLInputElement).value).toContain('250,00')
  })
})

// Neither suite above submits the contract after creating its one entity
// inline. This exercises both inline-creation flows back to back in a single
// contract and checks the actual submitted payload carries both freshly
// created ids — not just that each drawer closes and re-selects its row.
describe('inline client and product creation together', () => {
  it('creates a client and a product inline, then submits the contract with both new ids', async () => {
    mockCommonHooks()
    const createImpl = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(useContractsModule, 'useCreateContract').mockReturnValue({ mutateAsync: createImpl, isPending: false } as never)

    const newClient: Client = {
      id: 'c-combo', name: 'Cliente Combo', phone: '11999990000', email: '', notes: '',
      identityDocuments: [], addressLines: [], hasAllocationHistory: false, createdAt: '2026-07-31',
    }
    const newProduct = {
      id: 'p-combo', locationId: 'l1', name: 'Produto Combo', description: '', category: 'festa', size: 'G', color: 'rosa',
      rentalPrice: 300, depositAmount: 0, photos: [], status: 'active' as const, availability: 'available' as const,
      hasAllocationHistory: false, createdAt: '2026-07-31',
    }
    let serverClients: Client[] = [readyClient, incompleteClient]
    let serverProducts: (typeof product)[] = [product]
    vi.spyOn(apiModule, 'apiFetch').mockImplementation((async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      if (path === '/api/clients' && method === 'GET') return serverClients
      if (path === '/api/clients' && method === 'POST') {
        serverClients = [newClient, ...serverClients]
        return newClient
      }
      if (path === '/api/products' && method === 'GET') return serverProducts
      if (path === '/api/products' && method === 'POST') {
        serverProducts = [newProduct, ...serverProducts]
        return newProduct
      }
      throw new Error(`unexpected apiFetch call in test: ${method} ${path}`)
    }) as never)

    const queryClient = new QueryClient()
    queryClient.setQueryData(useClientsModule.CLIENTS_KEY, serverClients)
    queryClient.setQueryData(useProductsModule.PRODUCTS_KEY, serverProducts)
    renderWithToast(<NewContractForm onClose={vi.fn()} />, queryClient)

    await userEvent.click(screen.getByLabelText(/cliente/i))
    await userEvent.type(screen.getByRole('searchbox'), 'Cliente Combo')
    await userEvent.click(screen.getByRole('option', { name: /Criar cliente "Cliente Combo"/ }))
    expect(screen.getByRole('dialog', { name: 'Novo cliente' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Telefone'), '11999990000')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByLabelText(/cliente/i)).toHaveTextContent('Cliente Combo')

    await userEvent.type(screen.getByLabelText(/data do evento/i), '03102026')

    await userEvent.click(screen.getByLabelText(/produto/i))
    await userEvent.type(screen.getByRole('searchbox'), 'Produto Combo')
    await userEvent.click(screen.getByRole('option', { name: /Criar produto "Produto Combo"/ }))
    expect(screen.getByRole('dialog', { name: 'Novo produto' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Categoria'), 'festa')
    await userEvent.type(screen.getByLabelText('Tamanho'), 'G')
    await userEvent.type(screen.getByLabelText('Cor'), 'rosa')
    await userEvent.clear(screen.getByLabelText('Preço do aluguel'))
    await userEvent.type(screen.getByLabelText('Preço do aluguel'), '30000')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByLabelText(/produto/i)).toHaveTextContent('Produto Combo')

    await userEvent.type(screen.getByLabelText(/retirada/i), '02102026')
    await userEvent.type(screen.getByLabelText(/devolução/i), '05102026')
    await userEvent.selectOptions(screen.getByLabelText(/forma de pagamento/i), 'PIX')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }))

    // The just-created client has no CPF/RG/address on file, so the
    // client-readiness gate intercepts the first Salvar with a confirmation
    // dialog rather than submitting straight away.
    await userEvent.click(await screen.findByRole('button', { name: /salvar mesmo assim/i }))

    expect(createImpl).toHaveBeenCalledOnce()
    expect(createImpl.mock.calls[0][0].clientId).toBe('c-combo')
    expect(createImpl.mock.calls[0][0].items[0].productId).toBe('p-combo')
  })
})

describe('pricing', () => {
  it("fills the charged price with the product's rental price when a piece is picked", async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)

    await pickProduct(/Vestido Azul/)

    // Intl formats currency with a non-breaking space, so compare on the number.
    expect((screen.getByLabelText(/valor/i) as HTMLInputElement).value).toContain('100,00')
  })

  it('leaves an operator-typed price alone and totals what is actually charged', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await pickProduct(/Vestido Azul/)

    const priceField = screen.getByLabelText(/valor/i)
    await userEvent.clear(priceField)
    await userEvent.type(priceField, '8000')

    // Exact string, not a substring regex: the dialog footer also carries
    // the hint "As parcelas somam o total das peças.", which a loose match
    // would find first.
    expect(screen.getByText('Total das peças').parentElement).toHaveTextContent('R$ 80,00')
  })
})

describe('dialog format', () => {
  it('presents one dialog with both columns visible, not a wizard', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)

    // The study rejected step-by-step precisely because it hides fields:
    // client, event, pieces and instalments must all be reachable at once.
    expect(screen.getByText('Cliente e evento')).toBeInTheDocument()
    expect(screen.getByText('Peças')).toBeInTheDocument()
    expect(screen.getByText('Parcelas')).toBeInTheDocument()
    expect(screen.getByLabelText(/cliente/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/forma de pagamento/i)).toBeInTheDocument()

    // No step affordances of any kind.
    expect(screen.queryByRole('button', { name: /próximo|avançar|voltar/i })).not.toBeInTheDocument()
  })

  it('widens to page width once the contract passes four pieces, keeping the same fields', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)

    const panel = () => screen.getByRole('dialog')
    expect(panel().className).toContain('sm:max-w-[46rem]')

    // One format, two sizes — the study's single exception.
    for (let i = 0; i < 4; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: /adicionar peça/i }))
    }

    expect(panel().className).toContain('sm:max-w-[68rem]')
    // The fields did not change, only the width.
    expect(screen.getByText('Cliente e evento')).toBeInTheDocument()
    expect(screen.getByText('Parcelas')).toBeInTheDocument()
  })
})

describe('opened for a client already on screen', () => {
  it('starts with that client chosen instead of an empty field', async () => {
    mockHooks()
    renderWithToast(<NewContractForm clientId="c1" onClose={vi.fn()} />)

    // The combobox trigger is a button showing the chosen label, not an
    // input carrying a value.
    expect(await screen.findByLabelText(/cliente/i)).toHaveTextContent('Maria Completa')
  })

  it('does not treat the preselection as an unsaved edit', async () => {
    const onClose = vi.fn()
    mockHooks()
    renderWithToast(<NewContractForm clientId="c1" onClose={onClose} />)
    expect(await screen.findByLabelText(/cliente/i)).toHaveTextContent('Maria Completa')

    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }))

    // Closing an untouched dialog must not stop to ask about discarding —
    // the preselected client is a default value, not something typed.
    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalled()
  })

  it('opens empty, not broken, when the id no longer matches a client', async () => {
    mockHooks()
    renderWithToast(<NewContractForm clientId="ghost" onClose={vi.fn()} />)

    expect(await screen.findByLabelText(/cliente/i)).not.toHaveTextContent('Maria Completa')
  })

  it('still opens empty when nothing was preselected', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)

    expect(await screen.findByLabelText(/cliente/i)).not.toHaveTextContent('Maria Completa')
  })
})
