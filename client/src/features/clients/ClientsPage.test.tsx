import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../i18n.ts'
import { ClientsPage } from './ClientsPage.tsx'
import * as useClientsModule from './useClients.ts'

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient()
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('ClientsPage', () => {
  it('lists clients and opens the drawer in create mode when "Novo" is clicked', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [{ id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)

    expect(screen.getByText('Maria Silva')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Novo' }))
    expect(screen.getByLabelText('Nome')).toHaveValue('')
  })

  it('opens the drawer in edit mode pre-filled when a row is clicked', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [{ id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)
    await userEvent.click(screen.getByText('Maria Silva'))
    expect(screen.getByLabelText('Nome')).toHaveValue('Maria Silva')
  })
})
