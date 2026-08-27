import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router'
import '../../i18n.ts'
import { ClientsPage } from './ClientsPage.tsx'
import * as useClientsModule from './useClients.ts'
import * as useClientContractsModule from './useClientContracts.ts'
import * as useProductsModule from '../products/useProducts.ts'
import type { Contract } from '../contracts/contractSchemas.ts'
import type { Client } from './clientSchemas.ts'
import { Toaster } from '../../components/ui/sonner.tsx'

// The "Novo contrato" shortcut navigates, and the page mounts inside a router
// in the app, so every render here needs one too.
function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>
}

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/clientes']}>
        {ui}
        <LocationProbe />
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// contractCount/lastRentalProductId/lastRentalDate default to "never
// rented" — the same shape a brand-new client's row actually carries — so
// every test only has to state the fields it cares about.
function makeClient(overrides: Partial<Client> & Pick<Client, 'id' | 'name'>): Client {
  return {
    phone: '119',
    email: 'x@x.com',
    notes: '',
    createdAt: '2026-01-01',
    identityDocuments: [],
    addressLines: [],
    hasAllocationHistory: false,
    contractCount: 0,
    lastRentalProductId: null,
    lastRentalDate: null,
    ...overrides,
  } as Client
}

// ClientDetailPanel fetches its own history for whichever client is
// selected — this stands in for that request. Defaults to an empty,
// already-resolved history so tests that don't care about it don't have to
// mock it explicitly.
function mockClientHistory(contracts: Contract[] = [], isPending = false) {
  vi.spyOn(useClientContractsModule, 'useClientContractHistory').mockReturnValue({
    data: contracts,
    isPending,
  } as never)
}

function contract(id: string, clientId: string, allocations: { productId: string; checkoutDate: string }[]) {
  return {
    id,
    number: Number(id.replace(/\D/g, '')) || 1,
    clientId,
    eventDate: '2026-03-01',
    allocations: allocations.map((allocation, index) => ({
      id: `${id}-a${index}`,
      productId: allocation.productId,
      checkoutDate: allocation.checkoutDate,
      dueDate: allocation.checkoutDate,
      status: 'returned',
      priceCharged: 100,
    })),
    installments: [],
  } as unknown as Contract
}

describe('ClientsPage', () => {
  beforeEach(() => {
    mockClientHistory()
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [] } as never)
  })

  it('CRITICAL: a failed load reads as an error with a retry, not as an empty shop', async () => {
    // `data ?? []` used to send a failed query straight into the empty state:
    // "Nenhum cliente cadastrado", with a button offering to create one. On a
    // shop with 300 clients on file that is a lie she has no way to detect.
    const refetch = vi.fn()
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as never)

    renderWithQueryClient(<ClientsPage />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Nenhum cliente cadastrado')).not.toBeInTheDocument()

    // Structural, because jsdom cannot see the layout this pins: the guard has
    // to sit OUTSIDE the list/detail row. Inside it, the failure notice became
    // a flex sibling of the table — a full-height column beside it that
    // truncated every client name. Every test still passed.
    expect(screen.getByRole('alert').parentElement).not.toHaveClass('flex', 'min-h-0', 'flex-1')

    // The chrome has to survive the failure — it is how she leaves the screen.
    expect(screen.getByRole('button', { name: 'Novo cliente' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: finds accented names and pasted phone numbers', async () => {
    // Brazilian first names are heavily accented, so plain lowercasing was a
    // daily miss — and the client PICKER on the contract screen already folds,
    // so the same query worked there and not here. That inconsistency is what
    // makes her conclude the client was never registered and create a second.
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [
        makeClient({ id: '1', name: 'José Ferreira', phone: '(11) 98765-4321' }),
        makeClient({ id: '2', name: 'Antônio Prado', phone: '(11) 91111-2222' }),
      ],
      isLoading: false,
    } as never)
    renderWithQueryClient(<ClientsPage />)

    await userEvent.type(screen.getByPlaceholderText(/Buscar/), 'jose')
    expect(screen.getByText('José Ferreira')).toBeInTheDocument()
    expect(screen.queryByText('Antônio Prado')).not.toBeInTheDocument()

    await userEvent.clear(screen.getByPlaceholderText(/Buscar/))
    await userEvent.type(screen.getByPlaceholderText(/Buscar/), 'antonio')
    expect(screen.getByText('Antônio Prado')).toBeInTheDocument()

    // Pasted from a phone's contact list, unformatted.
    await userEvent.clear(screen.getByPlaceholderText(/Buscar/))
    await userEvent.type(screen.getByPlaceholderText(/Buscar/), '11987654321')
    expect(screen.getByText('José Ferreira')).toBeInTheDocument()
  })

  it('CRITICAL: does not offer Excluir on a client who can never be deleted', async () => {
    // Nearly every client has allocation history and the server refuses the
    // delete, so she was steeling herself for "não pode ser desfeita" on an
    // action that was never possible. That is how confirmations stop being
    // read, which matters because two in this app are genuinely irreversible.
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [makeClient({ id: '1', name: 'Maria Silva', hasAllocationHistory: true })],
      isLoading: false,
    } as never)
    renderWithQueryClient(<ClientsPage />)

    await userEvent.click(screen.getByText('Maria Silva'))
    const panel = document.querySelector('aside') as HTMLElement

    // The whole menu trigger is gone, not just the item — there is nothing
    // else behind it.
    expect(within(panel).queryByRole('button', { name: 'Mais ações' })).not.toBeInTheDocument()
    expect(screen.queryByText('Excluir')).not.toBeInTheDocument()
  })

  it('lists clients and opens the drawer in create mode when "Novo" is clicked', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [makeClient({ id: '1', name: 'Maria Silva' })],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)

    expect(screen.getByText('Maria Silva')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Novo cliente' }))
    expect(screen.getByLabelText('Nome')).toHaveValue('')
  })

  it('fills the detail panel when a row is clicked, without opening the drawer', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [makeClient({ id: '1', name: 'Maria Silva', email: 'm@x.com' })],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)

    // Before selection the panel prompts rather than showing a stale client.
    expect(
      screen.getByText('Selecione um cliente na lista para ver o cadastro e o histórico.'),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByText('Maria Silva'))

    // Reading a cadastro is the common case; it must not cost a modal.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Scoped to the panel rather than the document, so the assertion cannot
    // be satisfied by anything the list itself happens to render.
    const panel = document.querySelector('aside') as HTMLElement
    expect(within(panel).getByText('Contato e documentos')).toBeInTheDocument()
    expect(within(panel).getByText('m@x.com')).toBeInTheDocument()
  })

  it('opens the drawer pre-filled from the panel Editar button', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [makeClient({ id: '1', name: 'Maria Silva' })],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)
    await userEvent.click(screen.getByText('Maria Silva'))
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }))

    // Editing still uses the drawer — the browse experience changed, the
    // edit experience did not.
    expect(screen.getByLabelText('Nome')).toHaveValue('Maria Silva')
  })

  it('marks the selected row so it stays identifiable while the panel is read', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [
        makeClient({ id: '1', name: 'Maria Silva' }),
        makeClient({ id: '2', name: 'Beatriz Costa' }),
      ],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)
    await userEvent.click(screen.getByText('Beatriz Costa'))

    // The row's own control is an overlay button named after the row (the
    // row container itself is no longer a `role="button"`, so its `⋯` menu
    // stays reachable), so the selection marker lives on that button.
    expect(screen.getByRole('button', { current: true })).toHaveAccessibleName('Beatriz Costa')
  })

  it('groups the list alphabetically with a sticky letter heading', () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [
        makeClient({ id: '1', name: 'Maria Silva' }),
        makeClient({ id: '2', name: 'Beatriz Costa' }),
      ],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)

    // B before M, each under its own initial.
    const headings = [...document.querySelectorAll('.sticky')].map((node) => node.textContent?.charAt(0))
    expect(headings).toEqual(['B', 'M'])
  })

  it('filters the list by name, phone, or email as the search box is typed into', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [
        makeClient({ id: '1', name: 'Maria Silva', phone: '11999990000', email: 'maria@x.com' }),
        makeClient({ id: '2', name: 'Beatriz Costa', phone: '11888880000', email: 'beatriz@x.com' }),
      ],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)
    expect(screen.getByText('Maria Silva')).toBeInTheDocument()
    expect(screen.getByText('Beatriz Costa')).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText('Buscar por nome, telefone ou e-mail...'), 'beatriz')

    expect(screen.queryByText('Maria Silva')).not.toBeInTheDocument()
    expect(screen.getByText('Beatriz Costa')).toBeInTheDocument()
  })

  it('shows a no-results message when the search matches nothing', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [makeClient({ id: '1', name: 'Maria Silva' })],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)
    await userEvent.type(screen.getByPlaceholderText('Buscar por nome, telefone ou e-mail...'), 'zzz')

    expect(screen.getByText('Nenhum cliente encontrado para essa busca.')).toBeInTheDocument()
  })

  it('keeps the header and search pinned outside the scrollable list region', () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [makeClient({ id: '1', name: 'Maria Silva' })],
      isLoading: false,
    } as never)

    const { container } = renderWithQueryClient(<ClientsPage />)

    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('min-h-0')
    expect(root.className).toContain('flex-col')
    const scrollRegion = container.querySelector('.overflow-y-auto')
    expect(scrollRegion).not.toBeNull()
    expect(scrollRegion?.className).toContain('flex-1')
  })

  it('shows the last rented piece and the contract count instead of the e-mail', () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [
        makeClient({ id: '1', name: 'Maria Silva', contractCount: 2, lastRentalProductId: 'p2', lastRentalDate: '2026-02-14' }),
        makeClient({ id: '2', name: 'Beatriz Costa' }),
      ],
      isLoading: false,
    } as never)
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({
      data: [
        { id: 'p1', name: 'Vestido Longo Verde', photos: [] },
        { id: 'p2', name: 'Vestido Curto Rosa', photos: [] },
      ],
    } as never)

    renderWithQueryClient(<ClientsPage />)

    const header = screen.getByRole('row')
    expect(header).toHaveTextContent('Último aluguel')
    expect(header).toHaveTextContent('Contratos')
    expect(header).not.toHaveTextContent('E-mail')

    // These come straight off the client record now — lastRentalProductId
    // is already "whichever allocation was most recent", computed server
    // side, not recomputed here from a list of contracts.
    const maria = screen.getByText('Maria Silva').closest('.border-hairline') as HTMLElement
    expect(within(maria).getByText('Vestido Curto Rosa')).toBeInTheDocument()
    expect(within(maria).getByText('2')).toBeInTheDocument()

    const beatriz = screen.getByText('Beatriz Costa').closest('.border-hairline') as HTMLElement
    expect(within(beatriz).getByText('Nunca alugou')).toBeInTheDocument()
    expect(within(beatriz).getByText('0')).toBeInTheDocument()
  })

  it('adds the contract count to the detail panel subtitle, pluralised', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [
        makeClient({ id: '1', name: 'Maria Silva', contractCount: 2 }),
        makeClient({ id: '2', name: 'Beatriz Costa', contractCount: 1 }),
      ],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)
    const panel = document.querySelector('aside') as HTMLElement

    await userEvent.click(screen.getByText('Maria Silva'))
    expect(within(panel).getByText('Cliente desde janeiro de 2026 · 2 contratos')).toBeInTheDocument()

    // Singular is a different key, so it has to be exercised separately.
    await userEvent.click(screen.getByText('Beatriz Costa'))
    expect(within(panel).getByText('Cliente desde janeiro de 2026 · 1 contrato')).toBeInTheDocument()
  })

  it('CRITICAL: does not claim "sem histórico" in the panel while this client\'s own history query is still loading', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [makeClient({ id: '1', name: 'Maria Silva', contractCount: 2 })],
      isLoading: false,
    } as never)
    // The client record already says she has 2 contracts (a fact from the
    // clients query, already loaded) — but her actual history rows come
    // from a SEPARATE, still in-flight, per-client request. The panel must
    // not render "sem histórico" against that gap.
    mockClientHistory([], true)

    renderWithQueryClient(<ClientsPage />)
    await userEvent.click(screen.getByText('Maria Silva'))

    const panel = document.querySelector('aside') as HTMLElement
    expect(within(panel).getByText('Cliente desde janeiro de 2026 · 2 contratos')).toBeInTheDocument()
    expect(within(panel).queryByText(/sem histórico|nunca alugou/i)).not.toBeInTheDocument()
  })

  it('renders the fetched history rows once the per-client request resolves', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [makeClient({ id: '1', name: 'Maria Silva', contractCount: 1 })],
      isLoading: false,
    } as never)
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({
      data: [{ id: 'p1', name: 'Vestido Longo Verde', photos: [] }],
    } as never)
    mockClientHistory([contract('c1', '1', [{ productId: 'p1', checkoutDate: '2026-02-14' }])])

    renderWithQueryClient(<ClientsPage />)
    await userEvent.click(screen.getByText('Maria Silva'))

    const panel = document.querySelector('aside') as HTMLElement
    expect(within(panel).getByText('Vestido Longo Verde')).toBeInTheDocument()
  })

  it('offers deleting the client from the panel more-actions menu', async () => {
    const deleteClient = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [makeClient({ id: '1', name: 'Maria Silva' })],
      isLoading: false,
    } as never)
    vi.spyOn(useClientsModule, 'useDeleteClient').mockReturnValue({
      mutateAsync: deleteClient,
      isPending: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)
    await userEvent.click(screen.getByText('Maria Silva'))

    const panel = document.querySelector('aside') as HTMLElement
    await userEvent.click(within(panel).getByRole('button', { name: 'Mais ações' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excluir' }))

    // Destructive, so it asks first rather than firing off the mutation.
    expect(deleteClient).not.toHaveBeenCalled()
    expect(screen.getByText('Excluir Maria Silva?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(deleteClient).toHaveBeenCalledWith('1')
  })

  it('sends the rental-history shortcut to the new-contract flow', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [makeClient({ id: '1', name: 'Maria Silva' })],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)
    await userEvent.click(screen.getByText('Maria Silva'))

    const panel = document.querySelector('aside') as HTMLElement
    await userEvent.click(within(panel).getByRole('button', { name: 'Novo contrato' }))

    // Carries the client through, so the contract form opens with the person
    // already chosen. Without the id the shortcut saves one click and then
    // makes staff retype the name they just had selected.
    expect(screen.getByTestId('location')).toHaveTextContent('/contratos?novo=1&clienteId=1')
  })

  it('paginates the list rather than letting it run on forever', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: Array.from({ length: 25 }, (_, index) =>
        makeClient({
          id: String(index),
          // Zero-padded so alphabetical order matches the numeric order the
          // assertions below read it in.
          name: `Cliente ${String(index).padStart(2, '0')}`,
        }),
      ),
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)

    expect(screen.getByText('Cliente 00')).toBeInTheDocument()
    expect(screen.getByText('Cliente 19')).toBeInTheDocument()
    expect(screen.queryByText('Cliente 20')).not.toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Próximo' }))

    expect(screen.getByText('Cliente 20')).toBeInTheDocument()
    expect(screen.queryByText('Cliente 00')).not.toBeInTheDocument()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeDisabled()
  })

  it('returns to the first page when the search changes', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: Array.from({ length: 25 }, (_, index) =>
        makeClient({ id: String(index), name: `Cliente ${String(index).padStart(2, '0')}` }),
      ),
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    await userEvent.type(screen.getByPlaceholderText('Buscar por nome, telefone ou e-mail...'), 'Cliente')

    // Page 2 of the old result set would have shown nothing for a filter that
    // matches everything from the top.
    expect(screen.getByText('Cliente 00')).toBeInTheDocument()
  })
})
