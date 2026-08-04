import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { ProductDrawer } from './ProductDrawer.tsx'
import * as useProductsModule from './useProducts.ts'
import * as useAuthModule from '../../lib/useAuth.ts'
import { Toaster } from '../../components/ui/sonner.tsx'

// jsdom has no canvas, so the real downscale-to-JPEG step cannot run here.
// Stubbed to a recognisable data URL — what these tests are about is what the
// drawer does with the result, not the encoding itself.
vi.mock('../../lib/imageFile.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/imageFile.ts')>()
  return { ...actual, fileToJpegDataUrl: vi.fn(async (file: File) => `data:image/jpeg;base64,${file.name}`) }
})

function jpegFile(name: string, size = 1024) {
  const file = new File(['x'], name, { type: 'image/jpeg' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

function photoInput() {
  return screen.getByLabelText('Escolher fotos')
}

const product = {
  id: 'p1', locationId: 'l1', name: 'Vestido Azul', category: 'casual', size: 'P', color: 'azul',
  rentalPrice: 150, depositAmount: 50, status: 'active' as const, availability: 'available' as const,
  code: 1,
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
  uploadImpl: (...args: never[]) => Promise<unknown> = vi.fn(async () => ({ photos: [] })),
) {
  vi.spyOn(useProductsModule, 'useCreateProduct').mockReturnValue({ mutateAsync: createImpl } as never)
  vi.spyOn(useProductsModule, 'useUpdateProduct').mockReturnValue({ mutateAsync: updateImpl } as never)
  vi.spyOn(useProductsModule, 'useDeleteProduct').mockReturnValue({ mutateAsync: deleteImpl } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product] } as never)
  vi.spyOn(useProductsModule, 'useUploadProductPhotos').mockReturnValue({
    mutateAsync: uploadImpl,
  } as never)
  vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
    staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' },
    isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true,
  })
}

describe('ProductDrawer', () => {
  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn()
    mockProductHooks()
    renderWithToast(<ProductDrawer product={null} onClose={onClose} />)

    await userEvent.click(document.querySelector('[data-slot="sheet-overlay"]')!)

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes immediately when Cancelar is clicked on a pristine drawer', async () => {
    const onClose = vi.fn()
    mockProductHooks()
    renderWithToast(<ProductDrawer product={product} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('asks to confirm before discarding typed input when Cancelar is clicked', async () => {
    const onClose = vi.fn()
    mockProductHooks()
    renderWithToast(<ProductDrawer product={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('discards and closes once Descartar is confirmed', async () => {
    const onClose = vi.fn()
    mockProductHooks()
    renderWithToast(<ProductDrawer product={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps the drawer and the typed value when Continuar editando is chosen', async () => {
    const onClose = vi.fn()
    mockProductHooks()
    renderWithToast(<ProductDrawer product={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar editando' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Nome')).toHaveValue('Vestido Verde')
  })

  it('prompts instead of closing when the backdrop is clicked with unsaved input', async () => {
    const onClose = vi.fn()
    mockProductHooks()
    renderWithToast(<ProductDrawer product={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.click(document.querySelector('[data-slot="sheet-overlay"]')!)

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('prompts instead of closing when Escape is pressed with unsaved input', async () => {
    const onClose = vi.fn()
    mockProductHooks()
    renderWithToast(<ProductDrawer product={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.keyboard('{Escape}')

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Continuar editando' }))
    expect(screen.getByRole('dialog', { name: 'Novo produto' })).toBeInTheDocument()
  })

  it('prompts instead of closing when the header X is clicked with unsaved input', async () => {
    const onClose = vi.fn()
    mockProductHooks()
    renderWithToast(<ProductDrawer product={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('prompts when only a photo was added, which the form state cannot see', async () => {
    const onClose = vi.fn()
    mockProductHooks()
    renderWithToast(<ProductDrawer product={product} onClose={onClose} />)

    await userEvent.upload(photoInput(), jpegFile('nova.jpg'))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('prompts when a photo was removed', async () => {
    const onClose = vi.fn()
    mockProductHooks()
    renderWithToast(
      <ProductDrawer product={{ ...product, photos: ['https://example.com/a.jpg'] }} onClose={onClose} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Remover' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('prompts when only the status was changed', async () => {
    const onClose = vi.fn()
    mockProductHooks()
    renderWithToast(<ProductDrawer product={product} onClose={onClose} />)

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'maintenance')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not prompt when only "Salvar e adicionar outro" was toggled', async () => {
    const onClose = vi.fn()
    mockProductHooks()
    renderWithToast(<ProductDrawer product={null} onClose={onClose} />)

    await userEvent.click(screen.getByLabelText('Salvar e adicionar outro'))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not prompt after a save-and-add-another reset', async () => {
    const onClose = vi.fn()
    const createImpl = vi.fn().mockResolvedValue(undefined)
    mockProductHooks(vi.fn(), createImpl)
    renderWithToast(<ProductDrawer product={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.type(screen.getByLabelText('Categoria'), 'festa')
    await userEvent.type(screen.getByLabelText('Tamanho'), 'M')
    await userEvent.type(screen.getByLabelText('Cor'), 'verde')
    await userEvent.clear(screen.getByLabelText('Preço do aluguel'))
    await userEvent.type(screen.getByLabelText('Preço do aluguel'), '15000')
    await userEvent.click(screen.getByLabelText('Salvar e adicionar outro'))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument()
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
    expect(screen.getByText('Excluir Vestido Azul?')).toBeInTheDocument()
    expect(deleteImpl).not.toHaveBeenCalled()

    // Escape dismisses the confirmation dialog on top; the drawer underneath
    // (itself now a proper dialog) stays open rather than also closing.
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('Excluir Vestido Azul?')).not.toBeInTheDocument()
    // The drawer title now carries the piece's code alongside the heading.
    expect(screen.getByRole('dialog', { name: 'Editar produto · Nº 1' })).toBeInTheDocument()
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
    await userEvent.clear(screen.getByLabelText('Preço do aluguel'))
    await userEvent.type(screen.getByLabelText('Preço do aluguel'), '15000')
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
    renderWithToast(<ProductDrawer product={{ ...product, code: 1, hasAllocationHistory: true }} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })

  it('does not show a status field in create mode', () => {
    mockProductHooks(vi.fn())
    renderWithToast(<ProductDrawer product={null} onClose={vi.fn()} />)
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()
  })

  it('picks photos from disk and stores what the upload returned, not the local data URL', async () => {
    const onClose = vi.fn()
    const updateImpl = vi.fn().mockResolvedValue(undefined)
    const uploadImpl = vi.fn().mockResolvedValue({ photos: ['/api/products/p1/photos/aaa.jpg'] })
    mockProductHooks(vi.fn(), vi.fn(), updateImpl, uploadImpl)
    renderWithToast(<ProductDrawer product={product} onClose={onClose} />)

    await userEvent.upload(photoInput(), jpegFile('nova.jpg'))
    // Held locally until save, and labelled as such rather than shown as a URL.
    expect(screen.getByText('Enviada ao salvar')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(uploadImpl).toHaveBeenCalledWith({ id: 'p1', photos: ['data:image/jpeg;base64,nova.jpg'] })
    expect(updateImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'p1',
        // A data URL reaching the product row would be a photo that is never
        // served: the serving route only knows /api/products/<id>/photos/<f>.
        values: expect.objectContaining({ photos: ['/api/products/p1/photos/aaa.jpg'] }),
      }),
    )
  })

  /*
    The upload endpoint APPENDS, so for a piece that already had photos it
    hands back "the old ones, then the new ones" regardless of where the new
    one was dragged to. The saved array has to be the order on screen, or the
    piece's cover photo silently becomes whichever one was uploaded first.
  */
  it('CRITICAL: saves the order shown on screen, not the order the upload appended in', async () => {
    const updateImpl = vi.fn().mockResolvedValue(undefined)
    const uploadImpl = vi.fn().mockResolvedValue({
      photos: ['/api/products/p1/photos/old.jpg', '/api/products/p1/photos/new.jpg'],
    })
    mockProductHooks(vi.fn(), vi.fn(), updateImpl, uploadImpl)
    renderWithToast(
      <ProductDrawer
        product={{ ...product, photos: ['/api/products/p1/photos/old.jpg'] }}
        onClose={vi.fn()}
      />,
    )

    await userEvent.upload(photoInput(), jpegFile('nova.jpg'))
    // Promote the newly picked photo above the existing one.
    await userEvent.click(screen.getAllByRole('button', { name: 'Mover para cima' })[1])
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(updateImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.objectContaining({
          photos: ['/api/products/p1/photos/new.jpg', '/api/products/p1/photos/old.jpg'],
        }),
      }),
    )
  })

  it('creates the piece first, then uploads its photos to the id it just got', async () => {
    const createImpl = vi.fn().mockResolvedValue({ ...product, id: 'p9', photos: [] })
    const uploadImpl = vi.fn().mockResolvedValue({ photos: ['/api/products/p9/photos/bbb.jpg'] })
    mockProductHooks(vi.fn(), createImpl, vi.fn(), uploadImpl)
    renderWithToast(<ProductDrawer product={null} onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText(/nome/i), 'Vestido Novo')
    await userEvent.type(screen.getByLabelText('Categoria'), 'festa')
    await userEvent.type(screen.getByLabelText('Tamanho'), 'M')
    await userEvent.type(screen.getByLabelText('Cor'), 'azul')
    await userEvent.clear(screen.getByLabelText('Preço do aluguel'))
    await userEvent.type(screen.getByLabelText('Preço do aluguel'), '15000')
    await userEvent.upload(photoInput(), jpegFile('nova.jpg'))
    expect(await screen.findByText('Enviada ao salvar')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    // The create carries no data URL — the row cannot hold a photo that has
    // no id to be served under yet.
    expect(createImpl.mock.calls[0][0].photos).toEqual([])
    expect(uploadImpl).toHaveBeenCalledWith({ id: 'p9', photos: ['data:image/jpeg;base64,nova.jpg'] })
  })

  it('refuses a file over the size ceiling instead of trying to decode it', async () => {
    mockProductHooks()
    renderWithToast(<ProductDrawer product={product} onClose={vi.fn()} />)

    await userEvent.upload(photoInput(), jpegFile('enorme.jpg', 11 * 1024 * 1024))

    expect(await screen.findByText(/arquivo grande demais/)).toBeInTheDocument()
    expect(screen.getByText('Nenhuma foto ainda.')).toBeInTheDocument()
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

  it('prefills category/size/color/price/deposit from duplicateDefaults, leaving name and photos blank', () => {
    mockProductHooks(vi.fn())
    renderWithToast(
      <ProductDrawer
        product={null}
        onClose={vi.fn()}
        duplicateDefaults={{ category: 'festa', size: 'M', color: 'azul', rentalPrice: 200, depositAmount: 100 }}
      />,
    )

    expect(screen.getByLabelText('Categoria')).toHaveValue('festa')
    expect(screen.getByLabelText('Tamanho')).toHaveValue('M')
    expect(screen.getByLabelText('Cor')).toHaveValue('azul')
    expect(screen.getByLabelText('Nome')).toHaveValue('')
  })

  it('calls onCreated with the created product and stays open when "Salvar e adicionar outro" is checked', async () => {
    const onClose = vi.fn()
    const onCreated = vi.fn()
    const createdProduct = {
      id: 'p2', locationId: 'l1', name: 'Vestido Verde', category: 'festa', size: 'M', color: 'verde',
      rentalPrice: 150, depositAmount: 0, status: 'active' as const, availability: 'available' as const,
      code: 1,
      hasAllocationHistory: false, createdAt: '2026-01-02',
    }
    const createImpl = vi.fn().mockResolvedValue(createdProduct)
    mockProductHooks(vi.fn(), createImpl)
    renderWithToast(<ProductDrawer product={null} onClose={onClose} onCreated={onCreated} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.type(screen.getByLabelText('Categoria'), 'festa')
    await userEvent.type(screen.getByLabelText('Tamanho'), 'M')
    await userEvent.type(screen.getByLabelText('Cor'), 'verde')
    await userEvent.clear(screen.getByLabelText('Preço do aluguel'))
    await userEvent.type(screen.getByLabelText('Preço do aluguel'), '15000')
    await userEvent.click(screen.getByLabelText('Salvar e adicionar outro'))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(createImpl).toHaveBeenCalled()
    expect(onCreated).toHaveBeenCalledWith(createdProduct)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Nome')).toHaveValue('')
  })

  it('prefills the name field from initialName in create mode', () => {
    mockProductHooks(vi.fn())
    renderWithToast(<ProductDrawer product={null} onClose={vi.fn()} initialName="Vestido Rosa" />)

    expect(screen.getByLabelText('Nome')).toHaveValue('Vestido Rosa')
  })

  it('hides "Salvar e adicionar outro" when allowSaveAndAddAnother is false', () => {
    mockProductHooks(vi.fn())
    renderWithToast(<ProductDrawer product={null} onClose={vi.fn()} allowSaveAndAddAnother={false} />)

    expect(screen.queryByLabelText('Salvar e adicionar outro')).not.toBeInTheDocument()
  })

  it('closes normally when "Salvar e adicionar outro" is left unchecked', async () => {
    const onClose = vi.fn()
    const createImpl = vi.fn().mockResolvedValue(undefined)
    mockProductHooks(vi.fn(), createImpl)
    renderWithToast(<ProductDrawer product={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.type(screen.getByLabelText('Categoria'), 'festa')
    await userEvent.type(screen.getByLabelText('Tamanho'), 'M')
    await userEvent.type(screen.getByLabelText('Cor'), 'verde')
    await userEvent.clear(screen.getByLabelText('Preço do aluguel'))
    await userEvent.type(screen.getByLabelText('Preço do aluguel'), '15000')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(createImpl).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('rejects a rental price of zero instead of saving a free product', async () => {
    const createImpl = vi.fn().mockResolvedValue(undefined)
    mockProductHooks(vi.fn(), createImpl)
    renderWithToast(<ProductDrawer product={null} onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.type(screen.getByLabelText('Categoria'), 'festa')
    await userEvent.type(screen.getByLabelText('Tamanho'), 'M')
    await userEvent.type(screen.getByLabelText('Cor'), 'verde')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('Preço do aluguel deve ser maior que zero')).toBeInTheDocument()
    expect(createImpl).not.toHaveBeenCalled()
  })

  it('normalizes typed category/size/color to the casing already on file for the same value', async () => {
    const createImpl = vi.fn().mockResolvedValue(undefined)
    // The fixture `product` already has category 'casual', size 'P', color 'azul'.
    mockProductHooks(vi.fn(), createImpl)
    renderWithToast(<ProductDrawer product={null} onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.type(screen.getByLabelText('Categoria'), 'Casual')
    await userEvent.type(screen.getByLabelText('Tamanho'), 'P')
    await userEvent.type(screen.getByLabelText('Cor'), 'Azul')
    await userEvent.clear(screen.getByLabelText('Preço do aluguel'))
    await userEvent.type(screen.getByLabelText('Preço do aluguel'), '15000')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(createImpl).toHaveBeenCalledOnce()
    expect(createImpl.mock.calls[0][0]).toMatchObject({ category: 'casual', color: 'azul' })
  })

  it('does not show "Salvar e adicionar outro" in edit mode', () => {
    mockProductHooks(vi.fn())
    renderWithToast(<ProductDrawer product={product} onClose={vi.fn()} />)
    expect(screen.queryByLabelText('Salvar e adicionar outro')).not.toBeInTheDocument()
  })

  it('does not show the per-product remote-photo trigger (moved to ProductsPage as a session-level action)', () => {
    mockProductHooks(vi.fn())
    renderWithToast(<ProductDrawer product={product} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Adicionar fotos remotamente' })).not.toBeInTheDocument()
  })

  it('renders photo thumbnails large enough to be visually inspected, not icon-sized', () => {
    mockProductHooks(vi.fn())
    renderWithToast(
      <ProductDrawer product={{ ...product, photos: ['https://example.com/a.jpg'] }} onClose={vi.fn()} />,
    )
    const thumbnail = document.querySelector('img[src="https://example.com/a.jpg"]')
    expect(thumbnail).toHaveClass('h-16', 'w-16')
  })

  it('keeps the footer buttons inside the same scrollable region as the rest of the form, like ClientDrawer', () => {
    mockProductHooks(vi.fn())
    renderWithToast(<ProductDrawer product={product} onClose={vi.fn()} />)
    const saveButton = screen.getByRole('button', { name: 'Salvar' })
    const sheetBody = document.querySelector('[data-slot="sheet-body"]')
    expect(sheetBody).toContainElement(saveButton)
  })
})
