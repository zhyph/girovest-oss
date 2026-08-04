import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import '../../i18n.ts'
import { ProductsPage } from './ProductsPage.tsx'
import * as useProductsModule from './useProducts.ts'
import * as useAuthModule from '../../lib/useAuth.ts'
import { Toaster } from '../../components/ui/sonner.tsx'

const product = {
  id: 'p1', locationId: 'l1', code: 12, name: 'Vestido Azul', category: 'casual', size: 'P', color: 'azul',
  rentalPrice: 150, depositAmount: 50, status: 'active' as const, availability: 'available' as const,
  hasAllocationHistory: false,
  createdAt: '2026-01-01',
}

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient()
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <>{ui}<Toaster /></>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

function mockStaff() {
  vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
    staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' },
    isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true,
  } as never)
}

describe('ProductsPage', () => {
  it('lists products with their status', () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' }, isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true })

    renderWithQueryClient(<ProductsPage />)

    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('Disponível')).toBeInTheDocument()
  })

  it('opens the drawer in edit mode when a row is clicked', async () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' }, isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true })

    renderWithQueryClient(<ProductsPage />)
    await userEvent.click(screen.getByText('Vestido Azul'))
    expect(screen.getByLabelText('Nome')).toHaveValue('Vestido Azul')
  })

  it('badges a rented product as Alugado instead of the always-Disponível status field', () => {
    const rented = { ...product, id: 'p2', name: 'Vestido Rosa', availability: 'rented' as const }
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [rented], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' }, isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true })

    renderWithQueryClient(<ProductsPage />)

    expect(screen.getByText('Alugado')).toBeInTheDocument()
    expect(screen.queryByText('Disponível')).not.toBeInTheDocument()
  })

  it('remounts the drawer with fresh values when reopening it for a different row', async () => {
    const other = { ...product, id: 'p2', name: 'Vestido Rosa' }
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product, other], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' }, isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true })

    renderWithQueryClient(<ProductsPage />)
    await userEvent.click(screen.getByText('Vestido Azul'))
    expect(screen.getByLabelText('Nome')).toHaveValue('Vestido Azul')

    // The drawer is a real modal now (Critical #2 fix) — a background row
    // can't be clicked while it's open, so close it first, same as a real
    // user would, then reopen for the other row.
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await userEvent.click(screen.getByText('Vestido Rosa'))
    expect(screen.getByLabelText('Nome')).toHaveValue('Vestido Rosa')
  })

  it('filters the list by name, category, or color as the search box is typed into', async () => {
    const other = { ...product, id: 'p2', name: 'Vestido Rosa', category: 'festa', color: 'rosa' }
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product, other], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' }, isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true })

    renderWithQueryClient(<ProductsPage />)
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('Vestido Rosa')).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText('Buscar por código, nome, categoria ou cor...'), 'festa')

    expect(screen.queryByText('Vestido Azul')).not.toBeInTheDocument()
    expect(screen.getByText('Vestido Rosa')).toBeInTheDocument()
  })

  it('shows each piece\'s code in the grid and finds it by exact code', async () => {
    const other = { ...product, id: 'p2', code: 120, name: 'Vestido Rosa' }
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product, other], isLoading: false } as never)
    mockStaff()

    renderWithQueryClient(<ProductsPage />)
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText('Buscar por código, nome, categoria ou cor...'), '12')

    // Exact match, not substring: searching 12 must not also return 120.
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.queryByText('Vestido Rosa')).not.toBeInTheDocument()
  })

  it('shows a no-results message when the search matches nothing', async () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' }, isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true })

    renderWithQueryClient(<ProductsPage />)
    await userEvent.type(screen.getByPlaceholderText('Buscar por código, nome, categoria ou cor...'), 'zzz')

    expect(screen.getByText('Nenhum produto encontrado para essa busca.')).toBeInTheDocument()
  })

  it('remembers the last created product\'s category/size/color and prefills a fresh Novo later in the session', async () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' }, isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true })
    vi.spyOn(useProductsModule, 'useCreateProduct').mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        id: 'p2', locationId: 'l1', name: 'Vestido Verde', category: 'festa', size: 'M', color: 'verde',
        rentalPrice: 150, depositAmount: 0, status: 'active', availability: 'available',
        hasAllocationHistory: false, createdAt: '2026-01-02',
      }),
      isPending: false,
    } as never)
    vi.spyOn(useProductsModule, 'useUpdateProduct').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
    vi.spyOn(useProductsModule, 'useDeleteProduct').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)

    renderWithQueryClient(<ProductsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Novo' }))
    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.type(screen.getByLabelText('Categoria'), 'festa')
    await userEvent.type(screen.getByLabelText('Tamanho'), 'M')
    await userEvent.type(screen.getByLabelText('Cor'), 'verde')
    await userEvent.clear(screen.getByLabelText('Preço do aluguel'))
    await userEvent.type(screen.getByLabelText('Preço do aluguel'), '15000')
    await userEvent.click(screen.getByLabelText('Salvar e adicionar outro'))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(screen.getByLabelText('Nome')).toHaveValue('')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Novo' }))

    expect(screen.getByLabelText('Nome')).toHaveValue('')
    expect(screen.getByLabelText('Categoria')).toHaveValue('festa')
    expect(screen.getByLabelText('Tamanho')).toHaveValue('M')
    expect(screen.getByLabelText('Cor')).toHaveValue('verde')
  })

  it('does not update the remembered defaults when the drawer is closed without saving', async () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' }, isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true })
    vi.spyOn(useProductsModule, 'useCreateProduct').mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        id: 'p2', locationId: 'l1', name: 'Vestido Verde', category: 'festa', size: 'M', color: 'verde',
        rentalPrice: 150, depositAmount: 0, status: 'active', availability: 'available',
        hasAllocationHistory: false, createdAt: '2026-01-02',
      }),
      isPending: false,
    } as never)
    vi.spyOn(useProductsModule, 'useUpdateProduct').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
    vi.spyOn(useProductsModule, 'useDeleteProduct').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)

    renderWithQueryClient(<ProductsPage />)

    // First, successfully create-and-add-another so lastCreatedDefaults is populated.
    await userEvent.click(screen.getByRole('button', { name: 'Novo' }))
    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.type(screen.getByLabelText('Categoria'), 'festa')
    await userEvent.type(screen.getByLabelText('Tamanho'), 'M')
    await userEvent.type(screen.getByLabelText('Cor'), 'verde')
    await userEvent.clear(screen.getByLabelText('Preço do aluguel'))
    await userEvent.type(screen.getByLabelText('Preço do aluguel'), '15000')
    await userEvent.click(screen.getByLabelText('Salvar e adicionar outro'))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    // Now type unsaved edits into the still-open drawer and cancel instead of saving.
    // Cancelling with unsaved input now asks for confirmation first.
    await userEvent.type(screen.getByLabelText('Categoria'), 'unsaved')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    // The remembered defaults must still be the last *saved* values, not the unsaved edit.
    await userEvent.click(screen.getByRole('button', { name: 'Novo' }))
    expect(screen.getByLabelText('Categoria')).toHaveValue('festa')
    expect(screen.getByLabelText('Cor')).toHaveValue('verde')
  })

  it('does not crash and leaves Descrição blank when the created product has no description', async () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' }, isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true })
    vi.spyOn(useProductsModule, 'useCreateProduct').mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        id: 'p2', locationId: 'l1', name: 'Vestido Verde', description: null, category: 'festa', size: 'M', color: 'verde',
        rentalPrice: 150, depositAmount: 0, status: 'active', availability: 'available',
        hasAllocationHistory: false, createdAt: '2026-01-02',
      }),
      isPending: false,
    } as never)
    vi.spyOn(useProductsModule, 'useUpdateProduct').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
    vi.spyOn(useProductsModule, 'useDeleteProduct').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)

    renderWithQueryClient(<ProductsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Novo' }))
    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.type(screen.getByLabelText('Categoria'), 'festa')
    await userEvent.type(screen.getByLabelText('Tamanho'), 'M')
    await userEvent.type(screen.getByLabelText('Cor'), 'verde')
    await userEvent.clear(screen.getByLabelText('Preço do aluguel'))
    await userEvent.type(screen.getByLabelText('Preço do aluguel'), '15000')
    await userEvent.click(screen.getByLabelText('Salvar e adicionar outro'))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    // A `null` description handed straight to an uncontrolled register('description')
    // input would render "null" (or throw, depending on the input type) — this
    // must come through as an empty field instead.
    expect(screen.getByLabelText('Descrição')).toHaveValue('')
  })

  it('keeps the header and search pinned outside the scrollable list region', () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' }, isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true })

    const { container } = renderWithQueryClient(<ProductsPage />)

    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('min-h-0')
    expect(root.className).toContain('flex-col')
    const scrollRegion = container.querySelector('.overflow-y-auto')
    expect(scrollRegion).not.toBeNull()
    expect(scrollRegion?.className).toContain('flex-1')
  })

  it('opens the session-level remote-photo modal from a page-level trigger, with no product required', async () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' }, isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true })
    vi.spyOn(useProductsModule, 'useIssueProductPhotoSession').mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString(), port: 3000,
        candidates: [{ interfaceName: 'wlan0', address: '192.168.1.42' }],
      }),
      isPending: false,
    } as never)

    renderWithQueryClient(<ProductsPage />)

    // No products exist at all, yet the trigger is present and works.
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar fotos remotamente' }))
    expect(await screen.findByText('Fotos remotas')).toBeInTheDocument()
  })

  it('switches between the photo grid and the dense list without changing the result set', async () => {
    const rented = { ...product, id: 'p2', name: 'Terno Grafite', availability: 'rented' as const }
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product, rented], isLoading: false } as never)
    mockStaff()

    renderWithQueryClient(<ProductsPage />)

    // Grade is the default: a catalogue is browsed by eye before by name.
    expect(screen.getByRole('button', { name: 'Grade' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('row')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Lista' }))

    expect(screen.getByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'true')
    // The dense list brings real columns, which the grid has no use for.
    expect(screen.getByRole('row')).toBeInTheDocument()
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('Terno Grafite')).toBeInTheDocument()
  })

  it('filters by availability from the chips, with counts that follow the search', async () => {
    const rented = { ...product, id: 'p2', name: 'Terno Grafite', availability: 'rented' as const }
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product, rented], isLoading: false } as never)
    mockStaff()

    renderWithQueryClient(<ProductsPage />)

    expect(screen.getByRole('button', { name: /Todos/ })).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: /Disponíveis/ })).toHaveTextContent('1')

    await userEvent.click(screen.getByRole('button', { name: /Alugados/ }))

    expect(screen.getByText('Terno Grafite')).toBeInTheDocument()
    expect(screen.queryByText('Vestido Azul')).not.toBeInTheDocument()
  })

  // The server hands the catalogue back newest first, and these three are in
  // that order — so any assertion below that expects a different order is
  // reading the new sort control, not the incoming array.
  const catalogue = [
    { ...product, id: 'p1', code: 12, name: 'Vestido Azul', category: 'casual', size: 'P', rentalPrice: 150 },
    { ...product, id: 'p2', code: 3, name: 'Terno Grafite', category: 'Festa', size: 'M', rentalPrice: 400 },
    { ...product, id: 'p3', code: 25, name: 'Bolero Marfim', category: 'festa', size: 'P', rentalPrice: 90 },
  ]

  /** Names of the rendered cards, in the order they appear on screen. */
  function renderedNames() {
    return screen
      .getAllByText(/^(Vestido Azul|Terno Grafite|Bolero Marfim)$/)
      .map((node) => node.textContent)
  }

  async function openMenu(name: RegExp) {
    await userEvent.click(screen.getByRole('button', { name }))
  }

  it('narrows the catalogue to one category, folding the casing the shop typed', async () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: catalogue, isLoading: false } as never)
    mockStaff()

    renderWithQueryClient(<ProductsPage />)
    await openMenu(/Categoria e tamanho/)

    // "Festa" and "festa" are the same category typed by two people, so the
    // menu offers it once and selecting it has to bring back both pieces.
    expect(screen.getAllByRole('menuitemcheckbox', { name: /^[Ff]esta$/ })).toHaveLength(1)
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /^[Ff]esta$/ }))

    expect(screen.getByText('Terno Grafite')).toBeInTheDocument()
    expect(screen.getByText('Bolero Marfim')).toBeInTheDocument()
    expect(screen.queryByText('Vestido Azul')).not.toBeInTheDocument()
  })

  it('narrows the catalogue by size, and combines size with category', async () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: catalogue, isLoading: false } as never)
    mockStaff()

    renderWithQueryClient(<ProductsPage />)
    await openMenu(/Categoria e tamanho/)
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'P' }))

    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('Bolero Marfim')).toBeInTheDocument()
    expect(screen.queryByText('Terno Grafite')).not.toBeInTheDocument()

    // The menu stays open on a tick, so a second facet can be added without
    // reopening it. Across facets the two accumulate: festa *and* size P.
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /^[Ff]esta$/ }))

    expect(screen.getByText('Bolero Marfim')).toBeInTheDocument()
    expect(screen.queryByText('Vestido Azul')).not.toBeInTheDocument()
    expect(screen.queryByText('Terno Grafite')).not.toBeInTheDocument()
  })

  it('keeps the incoming order until a sort is picked, then reorders both views', async () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: catalogue, isLoading: false } as never)
    mockStaff()

    renderWithQueryClient(<ProductsPage />)

    // The default must be the order the screen already had before this control
    // existed, or adding it silently reshuffles every shop's catalogue.
    expect(renderedNames()).toEqual(['Vestido Azul', 'Terno Grafite', 'Bolero Marfim'])

    await openMenu(/Ordenar/)
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Nome (A-Z)' }))
    expect(renderedNames()).toEqual(['Bolero Marfim', 'Terno Grafite', 'Vestido Azul'])

    await openMenu(/Ordenar/)
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Código' }))
    expect(renderedNames()).toEqual(['Terno Grafite', 'Vestido Azul', 'Bolero Marfim'])

    // The list view renders from the same set, so it must carry the sort over.
    await userEvent.click(screen.getByRole('button', { name: 'Lista' }))
    expect(renderedNames()).toEqual(['Terno Grafite', 'Vestido Azul', 'Bolero Marfim'])

    await openMenu(/Ordenar/)
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Maior aluguel' }))
    expect(renderedNames()).toEqual(['Terno Grafite', 'Vestido Azul', 'Bolero Marfim'])

    await openMenu(/Ordenar/)
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Menor aluguel' }))
    expect(renderedNames()).toEqual(['Bolero Marfim', 'Vestido Azul', 'Terno Grafite'])
  })

  it('composes the category filter with the search box and the status chips', async () => {
    const rented = catalogue.map((item) =>
      item.id === 'p3' ? { ...item, availability: 'rented' as const } : item,
    )
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: rented, isLoading: false } as never)
    mockStaff()

    renderWithQueryClient(<ProductsPage />)
    await openMenu(/Categoria e tamanho/)
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /^[Ff]esta$/ }))
    await userEvent.keyboard('{Escape}')

    // The chips count the faceted set, not the whole catalogue: a chip that
    // still said 3 while two pieces were on screen would describe nothing.
    expect(screen.getByRole('button', { name: /Todos/ })).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: /Disponíveis/ })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: /Alugados/ })).toHaveTextContent('1')

    await userEvent.click(screen.getByRole('button', { name: /Alugados/ }))
    expect(screen.getByText('Bolero Marfim')).toBeInTheDocument()
    expect(screen.queryByText('Terno Grafite')).not.toBeInTheDocument()

    // And the search box narrows on top of both.
    await userEvent.click(screen.getByRole('button', { name: /Todos/ }))
    await userEvent.type(screen.getByPlaceholderText('Buscar por código, nome, categoria ou cor...'), 'Terno')

    expect(screen.getByText('Terno Grafite')).toBeInTheDocument()
    expect(screen.queryByText('Bolero Marfim')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Todos/ })).toHaveTextContent('1')
  })

  it('offers only the categories and sizes the shop actually has on file', async () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: catalogue, isLoading: false } as never)
    mockStaff()

    renderWithQueryClient(<ProductsPage />)
    await openMenu(/Categoria e tamanho/)

    // Sizes come back on the ladder the shop reads its rack in, not
    // alphabetically, which would put M ahead of P.
    const offered = screen.getAllByRole('menuitemcheckbox').map((node) => node.textContent)
    expect(offered).toEqual(['casual', 'Festa', 'P', 'M'])
  })

  it('does not give a retired piece an availability badge that says it is Disponível', () => {
    // `availability` is only meaningful while the piece is in the catalogue,
    // so the lifecycle status has to win when it is not active.
    const retired = { ...product, id: 'p3', name: 'Vestido Aposentado', status: 'retired' as const }
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [retired], isLoading: false } as never)
    mockStaff()

    renderWithQueryClient(<ProductsPage />)

    expect(screen.getByText('Aposentado')).toBeInTheDocument()
    expect(screen.queryByText('Disponível')).not.toBeInTheDocument()
  })
})
