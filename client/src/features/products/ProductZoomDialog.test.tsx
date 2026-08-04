import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router'
import '../../i18n.ts'
import { ProductZoomDialog } from './ProductZoomDialog.tsx'
import type { Product } from './productSchemas.ts'

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    locationId: 'l1',
    code: 42,
    name: 'Vestido Azul',
    category: 'festa',
    size: 'M',
    color: 'azul',
    rentalPrice: 250,
    depositAmount: 100,
    status: 'active',
    availability: 'available',
    hasAllocationHistory: false,
    createdAt: '2026-01-01',
    photos: ['/api/products/p1/photos/a.jpg'],
    ...overrides,
  }
}

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname + location.search}</span>
}

function renderZoom(product: Product | null, onClose = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={['/contratos']}>
      <ProductZoomDialog product={product} open={product !== null} onClose={onClose} />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProductZoomDialog', () => {
  it('renders nothing when no product is given', () => {
    renderZoom(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the piece name, code and the label/value grid the study asked for', () => {
    renderZoom(makeProduct())
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('Nº 42')).toBeInTheDocument()
    expect(screen.getByText('M')).toBeInTheDocument()
    expect(screen.getByText('azul')).toBeInTheDocument()
    expect(screen.getByText('festa')).toBeInTheDocument()
    expect(screen.getByText('Situação')).toBeInTheDocument()
  })

  /*
    The regression this panel exists to prevent. It is shown from Contratos,
    Clientes and Calendário — every one of which has an ALLOCATION in hand at
    the point of the click, and every one of which would happily hand its
    status ("Devolvido", "Atrasado", "Cancelado") to a status badge if the
    panel took one. Those words describe one contract's relationship to the
    piece, not the piece. A piece returned from a July contract and reserved
    for an August one is "Reservado", full stop.
  */
  it('CRITICAL: reports the piece own availability, never an allocation state word', () => {
    renderZoom(makeProduct({ availability: 'reserved' }))
    expect(screen.getByText('Reservado')).toBeInTheDocument()
    for (const allocationWord of ['Devolvido', 'Atrasado', 'Cancelado']) {
      expect(screen.queryByText(allocationWord)).not.toBeInTheDocument()
    }
  })

  it('lets the lifecycle status win, so a retired piece never reads as Disponível', () => {
    renderZoom(makeProduct({ status: 'retired', availability: 'available' }))
    expect(screen.getByText('Aposentado')).toBeInTheDocument()
    expect(screen.queryByText('Disponível')).not.toBeInTheDocument()
  })

  it('offers no photo paging for a piece with a single photo', () => {
    renderZoom(makeProduct())
    expect(screen.queryByRole('button', { name: 'Próxima foto' })).not.toBeInTheDocument()
  })

  it('cycles the pieces photos with the arrow keys, wrapping at both ends', async () => {
    renderZoom(
      makeProduct({
        photos: [
          '/api/products/p1/photos/a.jpg',
          '/api/products/p1/photos/b.jpg',
          '/api/products/p1/photos/c.jpg',
        ],
      }),
    )
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    // Wraps backwards past the first photo rather than sticking there.
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('falls back to the catalogue placeholder for a piece with no photos', () => {
    renderZoom(makeProduct({ photos: [] }))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
  })

  it('routes to the pieces own record in Produtos, and closes behind itself', async () => {
    const onClose = vi.fn()
    renderZoom(makeProduct(), onClose)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir ficha do produto' }))
    expect(onClose).toHaveBeenCalled()
    expect(screen.getByTestId('location')).toHaveTextContent('/produtos?peca=p1')
  })
})
