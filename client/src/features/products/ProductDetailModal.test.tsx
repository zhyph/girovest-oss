import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../i18n.ts'
import { ProductDetailModal } from './ProductDetailModal.tsx'
import type { Product } from './productSchemas.ts'

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    locationId: 'loc1',
    name: 'Vestido Azul',
    category: 'festa',
    size: 'M',
    color: 'azul',
    rentalPrice: 250,
    depositAmount: 150,
    description: 'Um vestido elegante.',
    photos: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    status: 'active',
    availability: 'available',
    code: 1,
    hasAllocationHistory: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('ProductDetailModal', () => {
  it('renders nothing (closed) when product is null', () => {
    render(<ProductDetailModal product={null} open={false} onClose={vi.fn()} />)
    expect(screen.queryByText('Vestido Azul')).not.toBeInTheDocument()
  })

  it('shows full product details and every photo when open', () => {
    render(<ProductDetailModal product={makeProduct()} open={true} onClose={vi.fn()} />)

    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('festa')).toBeInTheDocument()
    expect(screen.getByText('M')).toBeInTheDocument()
    expect(screen.getByText('azul')).toBeInTheDocument()
    expect(screen.getByText('Um vestido elegante.')).toBeInTheDocument()
    expect(screen.getByText(/250/)).toBeInTheDocument()
    expect(screen.getByText(/150/)).toBeInTheDocument()

    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(2)
    expect(images[0]).toHaveAttribute('src', 'https://example.com/a.jpg')
    expect(images[1]).toHaveAttribute('src', 'https://example.com/b.jpg')
  })

  it('does not render any edit or delete action', () => {
    render(<ProductDetailModal product={makeProduct()} open={true} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
})
