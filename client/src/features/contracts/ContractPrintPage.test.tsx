import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router'
import '../../i18n.ts'
import { ContractPrintPage } from './ContractPrintPage.tsx'
import * as useContractsModule from './useContracts.ts'
import type { ContractDetail } from './contractSchemas.ts'

const contract: ContractDetail = {
  id: 'ct1', number: 7, locationId: 'loc1', clientId: 'c1', staffId: 's1',
  eventDate: '2026-10-03', paymentMethod: 'PIX', signatureStatus: 'unsigned',
  signatureImage: null, signedAt: null, createdAt: '2026-09-01',
  location: {
    id: 'loc1', name: 'Priscila Moda Festa', address: 'Rua das Flores, 100',
    phone: '1199999999', locale: 'pt-BR', contractClauses: [],
  },
  client: { id: 'c1', name: 'Maria Souza', phone: '11988887777', email: 'maria@example.com', identityDocuments: [], addressLines: [] },
  allocations: [
    {
      id: 'al1', productId: 'p1', clientId: 'c1', staffId: 's1', contractId: 'ct1',
      checkoutDate: '2026-10-02', dueDate: '2026-10-06', actualReturnDate: null,
      status: 'reserved', priceCharged: 380, depositCollected: null, depositReturned: null,
      conditionNotesOut: null, conditionNotesIn: null, createdAt: '2026-09-01',
      product: { id: 'p1', name: 'Vestido Azul' },
    },
  ],
  installments: [],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/contratos/ct1/imprimir']}>
      <Routes>
        <Route path="/contratos/:id/imprimir" element={<ContractPrintPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ContractPrintPage', () => {
  beforeEach(() => {
    vi.spyOn(useContractsModule, 'useContract').mockReturnValue({ data: contract, isLoading: false } as never)
    vi.stubGlobal('print', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the contract document and an Imprimir action that calls window.print', async () => {
    renderPage()

    expect(screen.getByText('Priscila Moda Festa')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
    expect(window.print).toHaveBeenCalledTimes(1)
  })

  it('shows a Voltar action', () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument()
  })
})
