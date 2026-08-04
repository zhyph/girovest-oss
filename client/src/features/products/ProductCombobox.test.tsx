import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { ProductCombobox } from './ProductCombobox.tsx'
import type { Product } from './productSchemas.ts'

const products: Product[] = [
  { id: 'p1', locationId: 'l1', name: 'Vestido Azul', category: 'festa', size: 'M', color: 'azul', rentalPrice: 100, depositAmount: 50, photos: [], status: 'active', availability: 'available', code: 1, hasAllocationHistory: false, createdAt: '2026-01-01' },
  { id: 'p2', locationId: 'l1', name: 'Vestido Azul', category: 'festa', size: 'P', color: 'azul-claro', rentalPrice: 90, depositAmount: 50, photos: [], status: 'active', availability: 'available', code: 1, hasAllocationHistory: false, createdAt: '2026-01-01' },
]

describe('ProductCombobox', () => {
  it('shows size and color as the sublabel so same-named products are distinguishable', async () => {
    render(<ProductCombobox products={products} value="" onSelect={vi.fn()} onCreateNew={vi.fn()} aria-label="Produto" />)
    await userEvent.click(screen.getByLabelText('Produto'))

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('M · azul')
    expect(options[1]).toHaveTextContent('P · azul-claro')
  })

  it('renders the create-new row with the typed name', async () => {
    const onCreateNew = vi.fn()
    render(<ProductCombobox products={products} value="" onSelect={vi.fn()} onCreateNew={onCreateNew} aria-label="Produto" />)
    await userEvent.click(screen.getByLabelText('Produto'))
    await userEvent.type(screen.getByRole('searchbox'), 'Vestido Verde')
    await userEvent.click(screen.getByRole('option', { name: /Criar produto "Vestido Verde"/ }))

    expect(onCreateNew).toHaveBeenCalledWith('Vestido Verde')
  })

  it('shows a duplicate hint when the typed name exactly matches an existing product', async () => {
    render(<ProductCombobox products={products} value="" onSelect={vi.fn()} onCreateNew={vi.fn()} aria-label="Produto" />)
    await userEvent.click(screen.getByLabelText('Produto'))
    await userEvent.type(screen.getByRole('searchbox'), 'vestido azul')

    expect(screen.getByText('Já existe um produto com esse nome')).toBeInTheDocument()
  })
})
