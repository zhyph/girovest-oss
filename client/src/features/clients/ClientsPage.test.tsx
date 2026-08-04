import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router'
import '../../i18n.ts'
import { ClientsPage } from './ClientsPage.tsx'
import * as useClientsModule from './useClients.ts'
import * as useContractsModule from '../contracts/useContracts.ts'
import * as useProductsModule from '../products/useProducts.ts'
import type { Contract } from '../contracts/contractSchemas.ts'
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

function mockContracts(contracts: Contract[]) {
  vi.spyOn(useContractsModule, 'useContractsList').mockReturnValue({
    data: { contracts, total: contracts.length, page: 1, pageSize: 200 },
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
    // Default: nothing rented and no catalogue, so the tests that predate the
    // rental columns keep describing exactly what they always described.
    mockContracts([])
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [] } as never)
  })

  it('lists clients and opens the drawer in create mode when "Novo" is clicked', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [{ id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)

    expect(screen.getByText('Maria Silva')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Novo cliente' }))
    expect(screen.getByLabelText('Nome')).toHaveValue('')
  })

  it('fills the detail panel when a row is clicked, without opening the drawer', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [{ id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }],
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
      data: [{ id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }],
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
        { id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' },
        { id: '2', name: 'Beatriz Costa', phone: '118', email: 'b@x.com', notes: '', createdAt: '2026-01-01' },
      ],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)
    await userEvent.click(screen.getByText('Beatriz Costa'))

    const selected = screen.getByRole('button', { current: true })
    expect(selected).toHaveTextContent('Beatriz Costa')
    expect(selected).not.toHaveTextContent('Maria Silva')
  })

  it('groups the list alphabetically with a sticky letter heading', () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [
        { id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' },
        { id: '2', name: 'Beatriz Costa', phone: '118', email: 'b@x.com', notes: '', createdAt: '2026-01-01' },
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
        { id: '1', name: 'Maria Silva', phone: '11999990000', email: 'maria@x.com', notes: '', createdAt: '2026-01-01' },
        { id: '2', name: 'Beatriz Costa', phone: '11888880000', email: 'beatriz@x.com', notes: '', createdAt: '2026-01-01' },
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
      data: [{ id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)
    await userEvent.type(screen.getByPlaceholderText('Buscar por nome, telefone ou e-mail...'), 'zzz')

    expect(screen.getByText('Nenhum cliente encontrado para essa busca.')).toBeInTheDocument()
  })

  it('keeps the header and search pinned outside the scrollable list region', () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [{ id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }],
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
        { id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' },
        { id: '2', name: 'Beatriz Costa', phone: '118', email: 'b@x.com', notes: '', createdAt: '2026-01-01' },
      ],
      isLoading: false,
    } as never)
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({
      data: [
        { id: 'p1', name: 'Vestido Longo Verde', photos: [] },
        { id: 'p2', name: 'Vestido Curto Rosa', photos: [] },
      ],
    } as never)
    mockContracts([
      contract('c1', '1', [{ productId: 'p1', checkoutDate: '2025-06-10' }]),
      contract('c2', '1', [{ productId: 'p2', checkoutDate: '2026-02-14' }]),
    ])

    renderWithQueryClient(<ClientsPage />)

    const header = screen.getByRole('row')
    expect(header).toHaveTextContent('Último aluguel')
    expect(header).toHaveTextContent('Contratos')
    expect(header).not.toHaveTextContent('E-mail')

    // The later checkout wins, not the later contract row.
    const maria = screen.getByText('Maria Silva').closest('[role="button"]') as HTMLElement
    expect(within(maria).getByText('Vestido Curto Rosa')).toBeInTheDocument()
    expect(within(maria).queryByText('Vestido Longo Verde')).not.toBeInTheDocument()
    expect(within(maria).getByText('2')).toBeInTheDocument()

    const beatriz = screen.getByText('Beatriz Costa').closest('[role="button"]') as HTMLElement
    expect(within(beatriz).getByText('Nunca alugou')).toBeInTheDocument()
    expect(within(beatriz).getByText('0')).toBeInTheDocument()
  })

  it('adds the contract count to the detail panel subtitle, pluralised', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [
        { id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' },
        { id: '2', name: 'Beatriz Costa', phone: '118', email: 'b@x.com', notes: '', createdAt: '2026-01-01' },
      ],
      isLoading: false,
    } as never)
    mockContracts([
      contract('c1', '1', [{ productId: 'p1', checkoutDate: '2025-06-10' }]),
      contract('c2', '1', [{ productId: 'p2', checkoutDate: '2026-02-14' }]),
      contract('c3', '2', [{ productId: 'p1', checkoutDate: '2026-01-05' }]),
    ])

    renderWithQueryClient(<ClientsPage />)
    const panel = document.querySelector('aside') as HTMLElement

    await userEvent.click(screen.getByText('Maria Silva'))
    expect(within(panel).getByText('Cliente desde janeiro de 2026 · 2 contratos')).toBeInTheDocument()

    // Singular is a different key, so it has to be exercised separately.
    await userEvent.click(screen.getByText('Beatriz Costa'))
    expect(within(panel).getByText('Cliente desde janeiro de 2026 · 1 contrato')).toBeInTheDocument()
  })

  it('offers deleting the client from the panel more-actions menu', async () => {
    const deleteClient = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [{ id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }],
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
      data: [{ id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)
    await userEvent.click(screen.getByText('Maria Silva'))

    const panel = document.querySelector('aside') as HTMLElement
    await userEvent.click(within(panel).getByRole('button', { name: 'Novo contrato' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/contratos?novo=1')
  })

  it('paginates the list rather than letting it run on forever', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: Array.from({ length: 25 }, (_, index) => ({
        id: String(index),
        // Zero-padded so alphabetical order matches the numeric order the
        // assertions below read it in.
        name: `Cliente ${String(index).padStart(2, '0')}`,
        phone: '119',
        email: `c${index}@x.com`,
        notes: '',
        createdAt: '2026-01-01',
      })),
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
      data: Array.from({ length: 25 }, (_, index) => ({
        id: String(index),
        name: `Cliente ${String(index).padStart(2, '0')}`,
        phone: '119',
        email: `c${index}@x.com`,
        notes: '',
        createdAt: '2026-01-01',
      })),
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
