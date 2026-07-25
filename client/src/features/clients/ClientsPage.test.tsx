import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../i18n.ts'
import { ClientsPage } from './ClientsPage.tsx'
import * as useClientsModule from './useClients.ts'
import { Toaster } from '../../components/ui/sonner.tsx'

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <>{ui}<Toaster /></>
    </QueryClientProvider>,
  )
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

  it('filters the list by name, phone, or email as the search box is typed into', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [
        { id: '1', name: 'Maria Silva', phone: '11999990000', email: 'maria@x.com', notes: '', createdAt: '2026-01-01' },
        { id: '2', name: 'Beatriz Costa', phone: '11888880000', email: 'beatriz@x.com', notes: '', createdAt: '2026-01-01' },
      ],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)
    expect(screen.getByText('Maria Silva')).toBeInTheDocument()
    expect(screen.getByText('Beatriz Costa')).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText('Buscar por nome, telefone ou e-mail...'), 'beatriz')

    expect(screen.queryByText('Maria Silva')).not.toBeInTheDocument()
    expect(screen.getByText('Beatriz Costa')).toBeInTheDocument()
  })

  it('shows a no-results message when the search matches nothing', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [{ id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }],
      isLoading: false,
    } as never)

    renderWithQueryClient(<ClientsPage />)
    await userEvent.type(screen.getByPlaceholderText('Buscar por nome, telefone ou e-mail...'), 'zzz')

    expect(screen.getByText('Nenhum cliente encontrado para essa busca.')).toBeInTheDocument()
  })

  it('keeps the header and search pinned outside the scrollable list region', () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [{ id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }],
      isLoading: false,
    } as never)

    const { container } = renderWithQueryClient(<ClientsPage />)

    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('min-h-0')
    expect(root.className).toContain('flex-col')
    const scrollRegion = container.querySelector('.overflow-y-auto')
    expect(scrollRegion).not.toBeNull()
    expect(scrollRegion?.className).toContain('flex-1')
  })
})
