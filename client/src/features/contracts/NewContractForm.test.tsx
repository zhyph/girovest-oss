import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../i18n.ts'
import { NewContractForm } from './NewContractForm.tsx'
import * as useClientsModule from '../clients/useClients.ts'
import * as useProductsModule from '../products/useProducts.ts'
import * as useAllocationsModule from '../allocations/useAllocations.ts'
import * as useContractsModule from './useContracts.ts'
import { Toaster } from '../../components/ui/sonner.tsx'
import type { Client } from '../clients/clientSchemas.ts'

const readyClient: Client = {
  id: 'c1', name: 'Maria Completa', phone: '11999999999', email: 'm@example.com', notes: '',
  identityDocuments: [
    { id: 'd1', label: 'CPF', value: '123.456.789-00', maskKey: 'br-cpf' },
    { id: 'd2', label: 'RG', value: '12.345.678-9', maskKey: 'br-rg' },
  ],
  addressLines: [
    { id: 'a1', label: 'Endereço', value: 'Rua X, 1', sortOrder: 0, maskKey: null },
    { id: 'a2', label: 'Bairro', value: 'Centro', sortOrder: 1, maskKey: null },
    { id: 'a3', label: 'Cidade', value: 'Piedade', sortOrder: 2, maskKey: null },
    { id: 'a4', label: 'Estado', value: 'SP', sortOrder: 3, maskKey: null },
  ],
  hasAllocationHistory: false, createdAt: '2026-01-01',
}

const incompleteClient: Client = {
  id: 'c2', name: 'Joana Incompleta', phone: '11988888888', email: 'j@example.com', notes: '',
  identityDocuments: [], addressLines: [], hasAllocationHistory: false, createdAt: '2026-01-01',
}

const product = {
  id: 'p1', locationId: 'loc1', name: 'Vestido Azul', description: '', category: 'festa', size: 'M',
  color: 'azul', rentalPrice: 100, depositAmount: 50, photos: [], status: 'active' as const,
  createdAt: '2026-01-01', availability: 'available' as const, hasAllocationHistory: false,
}

function renderWithToast(ui: React.ReactElement) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <>{ui}<Toaster /></>
    </QueryClientProvider>,
  )
}

function mockHooks() {
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [readyClient, incompleteClient] } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product] } as never)
  vi.spyOn(useAllocationsModule, 'useProductAvailability').mockReturnValue({ data: { available: true } } as never)
  vi.spyOn(useContractsModule, 'useCreateContract').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
}

describe('NewContractForm', () => {
  it('shows no missing-fields warning for a client with every required field filled', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await userEvent.selectOptions(screen.getByLabelText(/cliente/i), 'c1')
    expect(screen.queryByText(/CPF, RG/)).not.toBeInTheDocument()
  })

  it('shows a missing-fields warning with a completion button for an incomplete client', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await userEvent.selectOptions(screen.getByLabelText(/cliente/i), 'c2')
    expect(screen.getByRole('button', { name: /completar cadastro/i })).toBeInTheDocument()
  })

  it('opens ClientDrawer for the selected client when "complete registration" is clicked', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await userEvent.selectOptions(screen.getByLabelText(/cliente/i), 'c2')
    await userEvent.click(screen.getByRole('button', { name: /completar cadastro/i }))
    expect(screen.getByLabelText(/nome/i)).toHaveValue('Joana Incompleta')
  })

  it('lets staff add a second line item', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /adicionar peça/i }))
    expect(screen.getAllByLabelText(/produto/i)).toHaveLength(2)
  })

  it('lets staff remove a line item', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /adicionar peça/i }))
    const removeButtons = screen.getAllByRole('button', { name: /remover peça/i })
    await userEvent.click(removeButtons[0])
    expect(screen.getAllByLabelText(/produto/i)).toHaveLength(1)
  })
})
