import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { ProductCombobox } from './ProductCombobox.tsx'
import type { Product } from './productSchemas.ts'

const products: Product[] = [
  { id: 'p1', locationId: 'l1', name: 'Vestido Azul', category: 'festa', size: 'M', color: 'azul', rentalPrice: 100, depositAmount: 50, photos: [], status: 'active', availability: 'available', code: 47, hasAllocationHistory: false, createdAt: '2026-01-01' },
  { id: 'p2', locationId: 'l1', name: 'Vestido Azul', category: 'festa', size: 'P', color: 'azul-claro', rentalPrice: 90, depositAmount: 50, photos: [], status: 'active', availability: 'available', code: 12, hasAllocationHistory: false, createdAt: '2026-01-01' },
]

describe('ProductCombobox', () => {
  it('shows the code, size and color as the sublabel so same-named products are distinguishable', async () => {
    render(<ProductCombobox products={products} value="" onSelect={vi.fn()} onCreateNew={vi.fn()} aria-label="Produto" />)
    await userEvent.click(screen.getByLabelText('Produto'))

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Nº 47 · M · azul')
    expect(options[1]).toHaveTextContent('Nº 12 · P · azul-claro')
  })

  it('CRITICAL: finds a product by the code the shop says out loud', async () => {
    const onSelect = vi.fn()
    render(<ProductCombobox products={products} value="" onSelect={onSelect} onCreateNew={vi.fn()} aria-label="Produto" />)
    await userEvent.click(screen.getByLabelText('Produto'))

    // Two identically named pieces; the code is the only thing that tells
    // them apart on the phone. Typing it used to leave the panel with nothing
    // but "Criar produto \"12\"" — the code was neither shown nor searched.
    await userEvent.type(screen.getByRole('searchbox'), '12')

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Nº 12 · P · azul-claro')
    await userEvent.click(options[0])
    expect(onSelect).toHaveBeenCalledWith('p2')
  })

  it('still lists a product that has no code yet', async () => {
    const uncoded: Product[] = [{ ...products[0], id: 'p3', name: 'Bolero', code: null }]
    render(<ProductCombobox products={uncoded} value="" onSelect={vi.fn()} onCreateNew={vi.fn()} aria-label="Produto" />)
    await userEvent.click(screen.getByLabelText('Produto'))

    expect(screen.getAllByRole('option')[0]).toHaveTextContent('M · azul')
    expect(screen.getAllByRole('option')[0]).not.toHaveTextContent('Nº')
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
