import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import '../../i18n.ts'
import { ContractsPage } from './ContractsPage.tsx'
import * as useContractsModule from './useContracts.ts'
import * as useProductsModule from '../products/useProducts.ts'
import * as useClientsModule from '../clients/useClients.ts'
import type { Contract } from './contractSchemas.ts'

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient()
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

const contract: Contract = {
  id: 'ct1', number: 3, locationId: 'loc1', clientId: 'c1', staffId: 's1',
  eventDate: '2026-10-03', paymentMethod: 'PIX', signatureStatus: 'unsigned',
  signatureImage: null, signedAt: null, createdAt: '2026-09-01',
  allocations: [
    {
      id: 'a1', productId: 'p1', clientId: 'c1', staffId: 's1', contractId: 'ct1',
      checkoutDate: '2026-10-02', dueDate: '2026-10-06', actualReturnDate: null,
      status: 'reserved', priceCharged: 380, depositCollected: null, depositReturned: null,
      conditionNotesOut: null, conditionNotesIn: null, createdAt: '2026-09-01',
    },
  ],
  installments: [{ id: 'i1', contractId: 'ct1', dueDate: '2026-09-20', amount: 380, paid: false, paidAt: null }],
}

function mockHooks() {
  vi.spyOn(useContractsModule, 'useContractsList').mockReturnValue({ data: [contract], isLoading: false } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [{ id: 'p1', name: 'Vestido Azul' }] } as never)
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [{ id: 'c1', name: 'Maria' }] } as never)
}

describe('ContractsPage', () => {
  it('shows the contract number, client, and its line item', () => {
    mockHooks()
    renderWithProviders(<ContractsPage />)
    expect(screen.getByText(/#3/)).toBeInTheDocument()
    expect(screen.getByText('Maria')).toBeInTheDocument()
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
  })

  it('shows the New Contract button and opens the form', async () => {
    mockHooks()
    renderWithProviders(<ContractsPage />)
    await userEvent.click(screen.getByRole('button', { name: /novo contrato/i }))
    expect(screen.getByLabelText(/cliente/i)).toBeInTheDocument()
  })

  it('shows the reserved item\'s check-out action', () => {
    mockHooks()
    renderWithProviders(<ContractsPage />)
    expect(screen.getByRole('button', { name: 'Check-out' })).toBeInTheDocument()
  })
})
