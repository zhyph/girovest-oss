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
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste' }, isLoadingStaff: false, login: vi.fn(), logout: vi.fn(), isLoggedIn: true })

    renderWithQueryClient(<ProductsPage />)

    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('Disponível')).toBeInTheDocument()
  })

  it('opens the drawer in edit mode when a row is clicked', async () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste' }, isLoadingStaff: false, login: vi.fn(), logout: vi.fn(), isLoggedIn: true })

    renderWithQueryClient(<ProductsPage />)
    await userEvent.click(screen.getByText('Vestido Azul'))
    expect(screen.getByLabelText('Nome')).toHaveValue('Vestido Azul')
  })

  it('badges a rented product as Alugado instead of the always-Disponível status field', () => {
    const rented = { ...product, id: 'p2', name: 'Vestido Rosa', availability: 'rented' as const }
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [rented], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste' }, isLoadingStaff: false, login: vi.fn(), logout: vi.fn(), isLoggedIn: true })

    renderWithQueryClient(<ProductsPage />)

    expect(screen.getByText('Alugado')).toBeInTheDocument()
    expect(screen.queryByText('Disponível')).not.toBeInTheDocument()
  })

  it('remounts the drawer with fresh values when switching rows without closing it', async () => {
    const other = { ...product, id: 'p2', name: 'Vestido Rosa' }
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product, other], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste' }, isLoadingStaff: false, login: vi.fn(), logout: vi.fn(), isLoggedIn: true })

    renderWithQueryClient(<ProductsPage />)
    await userEvent.click(screen.getByText('Vestido Azul'))
    expect(screen.getByLabelText('Nome')).toHaveValue('Vestido Azul')

    await userEvent.click(screen.getByText('Vestido Rosa'))
    expect(screen.getByLabelText('Nome')).toHaveValue('Vestido Rosa')
  })

  it('filters the list by name, category, or color as the search box is typed into', async () => {
    const other = { ...product, id: 'p2', name: 'Vestido Rosa', category: 'festa', color: 'rosa' }
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product, other], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste' }, isLoadingStaff: false, login: vi.fn(), logout: vi.fn(), isLoggedIn: true })

    renderWithQueryClient(<ProductsPage />)
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('Vestido Rosa')).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText('Buscar por nome, categoria ou cor...'), 'festa')

    expect(screen.queryByText('Vestido Azul')).not.toBeInTheDocument()
    expect(screen.getByText('Vestido Rosa')).toBeInTheDocument()
  })

  it('shows a no-results message when the search matches nothing', async () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste' }, isLoadingStaff: false, login: vi.fn(), logout: vi.fn(), isLoggedIn: true })

    renderWithQueryClient(<ProductsPage />)
    await userEvent.type(screen.getByPlaceholderText('Buscar por nome, categoria ou cor...'), 'zzz')

    expect(screen.getByText('Nenhum produto encontrado para essa busca.')).toBeInTheDocument()
  })
})
