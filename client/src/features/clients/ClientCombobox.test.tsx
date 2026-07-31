import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { ClientCombobox } from './ClientCombobox.tsx'
import type { Client } from './clientSchemas.ts'

const clients: Client[] = [
  { id: 'c1', name: 'Maria Silva', phone: '11999990000', email: '', notes: '', identityDocuments: [], addressLines: [], hasAllocationHistory: false, createdAt: '2026-01-01' },
  { id: 'c2', name: 'Cerimônia Souza', phone: '11988880000', email: '', notes: '', identityDocuments: [], addressLines: [], hasAllocationHistory: false, createdAt: '2026-01-01' },
]

describe('ClientCombobox', () => {
  it('lists clients sorted by name with phone as the sublabel', async () => {
    render(<ClientCombobox clients={clients} value="" onSelect={vi.fn()} onCreateNew={vi.fn()} aria-label="Cliente" />)
    await userEvent.click(screen.getByLabelText('Cliente'))

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Cerimônia Souza')
    expect(options[0]).toHaveTextContent('11988880000')
    expect(options[1]).toHaveTextContent('Maria Silva')
  })

  it('matches accent-insensitively when filtering', async () => {
    render(<ClientCombobox clients={clients} value="" onSelect={vi.fn()} onCreateNew={vi.fn()} aria-label="Cliente" />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'cerimonia')

    expect(screen.getByRole('option', { name: /Cerimônia Souza/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Maria Silva/ })).not.toBeInTheDocument()
  })

  it('renders the create-new row with the typed name', async () => {
    const onCreateNew = vi.fn()
    render(<ClientCombobox clients={clients} value="" onSelect={vi.fn()} onCreateNew={onCreateNew} aria-label="Cliente" />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'Nova Pessoa')
    await userEvent.click(screen.getByRole('option', { name: /Criar cliente "Nova Pessoa"/ }))

    expect(onCreateNew).toHaveBeenCalledWith('Nova Pessoa')
  })

  it('shows a duplicate hint when the typed name exactly matches an existing client', async () => {
    render(<ClientCombobox clients={clients} value="" onSelect={vi.fn()} onCreateNew={vi.fn()} aria-label="Cliente" />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'maria silva')

    expect(screen.getByText('Já existe um cliente com esse nome')).toBeInTheDocument()
  })
})
