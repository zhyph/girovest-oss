import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import '../../i18n.ts'
import { TOURS, tourStepSelector } from './tours.ts'
import { DashboardPage } from '../dashboard/DashboardPage.tsx'
import { ClientsPage } from '../clients/ClientsPage.tsx'
import { ProductsPage } from '../products/ProductsPage.tsx'
import { ContractsPage } from '../contracts/ContractsPage.tsx'
import * as useDashboardModule from '../dashboard/useDashboard.ts'
import * as useClientsModule from '../clients/useClients.ts'
import * as useProductsModule from '../products/useProducts.ts'
import * as useContractsModule from '../contracts/useContracts.ts'
import * as useAuthModule from '../../lib/useAuth.ts'
import * as useAllocationsModule from '../allocations/useAllocations.ts'

// Regression guard for tours.ts drift: every anchor a section's tour
// registers must actually exist as a `data-tour="<section>.<anchor>"`
// element once that section's page has real data to show. If a page's JSX
// is refactored and an anchor is renamed/removed without updating tours.ts,
// this fails loudly here instead of silently truncating the tour in front
// of a client.
function expectAllAnchorsPresent(section: keyof typeof TOURS) {
  for (const step of TOURS[section]) {
    const selector = tourStepSelector(section, step.anchor)
    expect(document.querySelector(selector), `missing anchor for ${section}.${step.anchor}`).not.toBeNull()
  }
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient()
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  // Every section is pre-marked "seen" so useSectionTour's auto-launch never
  // fires driver.js here — these tests only care about anchor presence.
  for (const section of Object.keys(TOURS)) {
    localStorage.setItem(`girovest.tour.v1.${section}`, '1')
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('tour anchors match rendered DOM', () => {
  it('dashboard: todas as âncoras existem (cenário de loja nova, cobre o cartão de boas-vindas)', () => {
    vi.spyOn(useDashboardModule, 'useDashboard').mockReturnValue({
      goingOutToday: [] as never,
      dueBackToday: [] as never,
      overdue: [] as never,
      upcoming: [] as never,
      isLoading: false,
      isError: false,
    })
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [], isLoading: false } as never)
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [], isLoading: false } as never)

    renderWithProviders(<DashboardPage />)

    expectAllAnchorsPresent('dashboard')
  })

  it('clients: todas as âncoras existem com pelo menos um cliente cadastrado', () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [{ id: '1', name: 'Maria Silva', phone: '11999990000', email: 'maria@x.com', notes: '', createdAt: '2026-01-01' }],
      isLoading: false,
    } as never)

    renderWithProviders(<ClientsPage />)

    expectAllAnchorsPresent('clients')
  })

  it('products: todas as âncoras existem com pelo menos um produto cadastrado', () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({
      data: [{
        id: 'p1', locationId: 'l1', name: 'Vestido Azul', category: 'casual', size: 'P', color: 'azul',
        rentalPrice: 150, depositAmount: 50, status: 'active', availability: 'available',
        hasAllocationHistory: false, createdAt: '2026-01-01',
      }],
      isLoading: false,
    } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' },
      isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true,
    })

    renderWithProviders(<ProductsPage />)

    expectAllAnchorsPresent('products')
  })

  it('contracts: todas as âncoras existem, incluindo paginação com múltiplas páginas', () => {
    vi.spyOn(useContractsModule, 'useContractsList').mockReturnValue({
      data: {
        contracts: [{
          id: 'ct1', number: 3, locationId: 'loc1', clientId: 'c1', staffId: 's1',
          eventDate: '2026-10-03', paymentMethod: 'PIX', signatureStatus: 'unsigned',
          signatureImage: null, signedAt: null, createdAt: '2026-09-01',
          allocations: [{
            id: 'a1', productId: 'p1', clientId: 'c1', staffId: 's1', contractId: 'ct1',
            checkoutDate: '2026-10-02', actualCheckoutDate: null, dueDate: '2026-10-06', actualReturnDate: null,
            status: 'reserved', priceCharged: 380, depositCollected: null, depositReturned: null,
            conditionNotesOut: null, conditionNotesIn: null, createdAt: '2026-09-01',
          }],
          installments: [],
        }],
        total: 25,
        page: 1,
        pageSize: 20,
      },
      isLoading: false,
    } as never)
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [{ id: 'p1', name: 'Vestido Azul' }] } as never)
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [{ id: 'c1', name: 'Maria' }] } as never)
    vi.spyOn(useAllocationsModule, 'useCheckOutAllocation').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
    vi.spyOn(useAllocationsModule, 'useReturnAllocation').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
    vi.spyOn(useAllocationsModule, 'useCancelAllocation').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)

    renderWithProviders(<ContractsPage />)

    expectAllAnchorsPresent('contracts')
  })
})
