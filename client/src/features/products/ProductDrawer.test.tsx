import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { ProductDrawer } from './ProductDrawer.tsx'
import * as useProductsModule from './useProducts.ts'
import * as useAuthModule from '../../lib/useAuth.ts'

const product = {
  id: 'p1', locationId: 'l1', name: 'Vestido Azul', category: 'casual', size: 'P', color: 'azul',
  rentalPrice: 150, depositAmount: 50, status: 'active' as const, createdAt: '2026-01-01',
}

function mockProductHooks(
  deleteImpl: () => Promise<unknown> = vi.fn(),
  createImpl: (...args: never[]) => Promise<unknown> = vi.fn(),
  updateImpl: (...args: never[]) => Promise<unknown> = vi.fn(),
) {
  vi.spyOn(useProductsModule, 'useCreateProduct').mockReturnValue({ mutateAsync: createImpl } as never)
  vi.spyOn(useProductsModule, 'useUpdateProduct').mockReturnValue({ mutateAsync: updateImpl } as never)
  vi.spyOn(useProductsModule, 'useDeleteProduct').mockReturnValue({ mutateAsync: deleteImpl } as never)
  vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
    staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste' },
    isLoadingStaff: false, login: vi.fn(), logout: vi.fn(), isLoggedIn: true,
  })
}

describe('ProductDrawer', () => {
  it('does not show a delete button in create mode', () => {
    mockProductHooks(vi.fn())
    render(<ProductDrawer product={null} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })

  it('shows the translated error when deleting a product with allocation history', async () => {
    mockProductHooks(vi.fn().mockRejectedValue({ code: 'CANNOT_DELETE_WITH_HISTORY', message: 'nope' }))
    render(<ProductDrawer product={product} onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    expect(
      await screen.findByText('Não é possível excluir um produto com histórico de alocações.'),
    ).toBeInTheDocument()
  })

  it('shows a translated error and does not close the drawer when creating a product fails', async () => {
    const onClose = vi.fn()
    const createImpl = vi.fn().mockRejectedValue({ code: 'UNKNOWN', message: 'network error' })
    mockProductHooks(vi.fn(), createImpl)
    render(<ProductDrawer product={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.type(screen.getByLabelText('Categoria'), 'casual')
    await userEvent.type(screen.getByLabelText('Tamanho'), 'M')
    await userEvent.type(screen.getByLabelText('Cor'), 'verde')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('Algo deu errado. Tente novamente.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows a translated error and does not close the drawer when updating a product fails', async () => {
    const onClose = vi.fn()
    const updateImpl = vi.fn().mockRejectedValue({ code: 'UNKNOWN', message: 'network error' })
    mockProductHooks(vi.fn(), vi.fn(), updateImpl)
    render(<ProductDrawer product={product} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('Algo deu errado. Tente novamente.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
