import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../i18n.ts'
import { ProductsPage } from './ProductsPage.tsx'
import * as useProductsModule from './useProducts.ts'
import * as useAuthModule from '../../lib/useAuth.ts'
import { Toaster } from '../../components/ui/sonner.tsx'

const product = {
  id: 'p1', locationId: 'l1', name: 'Vestido Azul', category: 'casual', size: 'P', color: 'azul',
  rentalPrice: 150, depositAmount: 50, status: 'active' as const, availability: 'available' as const,
  hasAllocationHistory: false,
  createdAt: '2026-01-01',
}

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <>{ui}<Toaster /></>
    </QueryClientProvider>,
  )
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

    await userEvent.type(screen.getByPlaceholderText('Buscar por nome, categoria ou cor...'), 'festa')

    expect(screen.queryByText('Vestido Azul')).not.toBeInTheDocument()
    expect(screen.getByText('Vestido Rosa')).toBeInTheDocument()
  })

  it('shows a no-results message when the search matches nothing', async () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' }, isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true })

    renderWithQueryClient(<ProductsPage />)
    await userEvent.type(screen.getByPlaceholderText('Buscar por nome, categoria ou cor...'), 'zzz')

    expect(screen.getByText('Nenhum produto encontrado para essa busca.')).toBeInTheDocument()
  })

  it('remembers the last created product\'s category/size/color and prefills a fresh Novo later in the session', async () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' }, isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true })
    vi.spyOn(useProductsModule, 'useCreateProduct').mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false } as never)
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
    vi.spyOn(useProductsModule, 'useCreateProduct').mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false } as never)
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
})
