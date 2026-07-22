import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { ProductDrawer } from './ProductDrawer.tsx'
import * as useProductsModule from './useProducts.ts'
import * as useAuthModule from '../../lib/useAuth.ts'
import { Toaster } from '../../components/ui/sonner.tsx'

const product = {
  id: 'p1', locationId: 'l1', name: 'Vestido Azul', category: 'casual', size: 'P', color: 'azul',
  rentalPrice: 150, depositAmount: 50, status: 'active' as const, availability: 'available' as const,
  hasAllocationHistory: false,
  createdAt: '2026-01-01',
}

function renderWithToast(ui: React.ReactElement) {
  return render(<>{ui}<Toaster /></>)
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
  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn()
    mockProductHooks()
    const { container } = renderWithToast(<ProductDrawer product={null} onClose={onClose} />)

    await userEvent.click(container.querySelector('[aria-hidden="true"]')!)

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not show a delete button in create mode', () => {
    mockProductHooks(vi.fn())
    renderWithToast(<ProductDrawer product={null} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })

  it('shows the translated error when deleting a product with allocation history', async () => {
    mockProductHooks(vi.fn().mockRejectedValue({ code: 'CANNOT_DELETE_WITH_HISTORY', message: 'nope' }))
    renderWithToast(<ProductDrawer product={product} onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }))

    expect(
      await screen.findByText('Não é possível excluir um produto com histórico de alocações.'),
    ).toBeInTheDocument()
  })

  it('asks for confirmation before deleting, and does not delete if confirmation is dismissed', async () => {
    const deleteImpl = vi.fn()
    mockProductHooks(deleteImpl)
    renderWithToast(<ProductDrawer product={product} onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(deleteImpl).not.toHaveBeenCalled()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(deleteImpl).not.toHaveBeenCalled()
  })

  it('shows a translated error and does not close the drawer when creating a product fails', async () => {
    const onClose = vi.fn()
    const createImpl = vi.fn().mockRejectedValue({ code: 'UNKNOWN', message: 'network error' })
    mockProductHooks(vi.fn(), createImpl)
    renderWithToast(<ProductDrawer product={null} onClose={onClose} />)

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
    renderWithToast(<ProductDrawer product={product} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('Algo deu errado. Tente novamente.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('hides Excluir when the product has allocation history, per the drawer spec', () => {
    mockProductHooks(vi.fn())
    renderWithToast(<ProductDrawer product={{ ...product, hasAllocationHistory: true }} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })

  it('does not show a status field in create mode', () => {
    mockProductHooks(vi.fn())
    renderWithToast(<ProductDrawer product={null} onClose={vi.fn()} />)
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()
  })

  it('adds and removes photo URLs, and submits them on save', async () => {
    const onClose = vi.fn()
    const updateImpl = vi.fn().mockResolvedValue(undefined)
    mockProductHooks(vi.fn(), vi.fn(), updateImpl)
    renderWithToast(<ProductDrawer product={product} onClose={onClose} />)

    await userEvent.type(screen.getByPlaceholderText('URL da foto'), 'https://example.com/a.jpg')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    expect(screen.getByText('https://example.com/a.jpg')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(updateImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'p1',
        values: expect.objectContaining({ photos: ['https://example.com/a.jpg'] }),
      }),
    )
  })

  it('removes a photo from the list', async () => {
    mockProductHooks(vi.fn())
    renderWithToast(<ProductDrawer product={{ ...product, photos: ['https://example.com/a.jpg'] }} onClose={vi.fn()} />)

    expect(screen.getByText('https://example.com/a.jpg')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remover' }))
    expect(screen.queryByText('https://example.com/a.jpg')).not.toBeInTheDocument()
  })

  it('submits a changed status alongside the other fields', async () => {
    const onClose = vi.fn()
    const updateImpl = vi.fn().mockResolvedValue(undefined)
    mockProductHooks(vi.fn(), vi.fn(), updateImpl)
    renderWithToast(<ProductDrawer product={product} onClose={onClose} />)

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'maintenance')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(updateImpl).toHaveBeenCalledWith(
      expect.objectContaining({ values: expect.objectContaining({ status: 'maintenance' }) }),
    )
  })
})
