import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EntityCombobox, type EntityComboboxRow } from './entity-combobox.tsx'

const ROWS: EntityComboboxRow[] = [
  { id: '1', label: 'Maria Silva', sublabel: '11999990000' },
  { id: '2', label: 'João Souza', sublabel: '11988880000' },
  { id: '3', label: 'Ana Costa', sublabel: '11977770000' },
]

function Harness({
  rows = ROWS,
  onSelect = vi.fn(),
  onCreateNew = vi.fn(),
  duplicateHint = () => undefined,
  emptyHint,
  moreResultsHint,
}: {
  rows?: EntityComboboxRow[]
  onSelect?: (id: string) => void
  onCreateNew?: (query: string) => void
  duplicateHint?: (query: string) => string | undefined
  emptyHint?: string
  moreResultsHint?: (shown: number, total: number) => string
}) {
  const [value, setValue] = useState('')
  return (
    <EntityCombobox
      rows={rows}
      value={value}
      onSelect={(id) => {
        setValue(id)
        onSelect(id)
      }}
      onCreateNew={onCreateNew}
      createLabel={(query) => `Criar "${query}"`}
      duplicateHint={duplicateHint}
      emptyHint={emptyHint}
      moreResultsHint={moreResultsHint}
      aria-label="Cliente"
    />
  )
}

describe('EntityCombobox', () => {
  it('gives the search input its own accessible name, distinct from the reused placeholder', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('Cliente'))

    expect(screen.getByRole('searchbox', { name: 'Buscar' })).toBeInTheDocument()
  })

  it('shows every row once opened, with no create row while the search is empty', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('Cliente'))

    expect(screen.getByRole('option', { name: /Maria Silva/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /João Souza/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^Criar/ })).not.toBeInTheDocument()
  })

  it('filters by label and sublabel, ignoring case and accents', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), '999990000')

    expect(screen.getByRole('option', { name: /Maria Silva/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /João Souza/ })).not.toBeInTheDocument()
  })

  it('always renders the create row last once there is a query, regardless of matches', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'Maria')

    const options = screen.getAllByRole('option')
    expect(options[options.length - 1]).toHaveTextContent('Criar "Maria"')
  })

  it('selecting a row calls onSelect and closes the popover', async () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.click(screen.getByRole('option', { name: /Ana Costa/ }))

    expect(onSelect).toHaveBeenCalledWith('3')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('selecting the create row calls onCreateNew with the trimmed query', async () => {
    const onCreateNew = vi.fn()
    render(<Harness onCreateNew={onCreateNew} />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), '  Nova Pessoa  ')
    await userEvent.click(screen.getByRole('option', { name: /^Criar/ }))

    expect(onCreateNew).toHaveBeenCalledWith('Nova Pessoa')
  })

  it('the first match is highlighted by default so Enter selects it, not the create row', async () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'Maria')
    await userEvent.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith('1')
  })

  it('arrow keys move the highlight down to the create row and Enter creates', async () => {
    const onCreateNew = vi.fn()
    render(<Harness rows={[ROWS[0]]} onCreateNew={onCreateNew} />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'Maria')
    await userEvent.keyboard('{ArrowDown}{Enter}')

    expect(onCreateNew).toHaveBeenCalledWith('Maria')
  })

  it('shows the duplicate hint next to the create row on an exact accent/case-insensitive match', async () => {
    render(<Harness duplicateHint={(query) => (query.toLowerCase() === 'maria silva' ? 'Já existe' : undefined)} />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'MARIA SILVA')

    expect(screen.getByText('Já existe')).toBeInTheDocument()
  })

  it('shows the selected row label on the trigger after selecting', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.click(screen.getByRole('option', { name: /João Souza/ }))

    expect(screen.getByLabelText('Cliente')).toHaveTextContent('João Souza')
  })

  it('closes on Escape without selecting or creating anything', async () => {
    const onSelect = vi.fn()
    const onCreateNew = vi.fn()
    render(<Harness onSelect={onSelect} onCreateNew={onCreateNew} />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'Maria')

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
    expect(onCreateNew).not.toHaveBeenCalled()
  })

  it('restores focus to the trigger button after selecting a row, instead of dropping it to <body>', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.click(screen.getByRole('option', { name: /João Souza/ }))

    expect(screen.getByLabelText('Cliente')).toHaveFocus()
  })

  it('restores focus to the trigger button after pressing Escape, instead of dropping it to <body>', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.keyboard('{Escape}')

    expect(screen.getByLabelText('Cliente')).toHaveFocus()
  })

  it('shows a non-interactive "more results" footer, before the create row, when a query matches more than the visible cap', async () => {
    const manyRows: EntityComboboxRow[] = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      label: `Cliente ${String(i).padStart(2, '0')}`,
    }))
    render(<Harness rows={manyRows} moreResultsHint={(shown, total) => `Mostrando ${shown} de ${total}`} />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'Cliente')

    expect(screen.getByText('Mostrando 20 de 25')).toBeInTheDocument()
    // Footer is informational only, never an option Enter/click could commit.
    expect(screen.queryByRole('option', { name: 'Mostrando 20 de 25' })).not.toBeInTheDocument()
    const options = screen.getAllByRole('option')
    expect(options[options.length - 1]).toHaveTextContent('Criar "Cliente"')
  })

  it('does not show the "more results" footer when every match is already visible', async () => {
    render(<Harness moreResultsHint={(shown, total) => `Mostrando ${shown} de ${total}`} />)
    await userEvent.click(screen.getByLabelText('Cliente'))

    expect(screen.queryByText(/^Mostrando/)).not.toBeInTheDocument()
  })

  it('shows the empty hint when there are zero rows and the search is still empty', async () => {
    render(<Harness rows={[]} emptyHint="Digite um nome para buscar ou cadastrar" />)
    await userEvent.click(screen.getByLabelText('Cliente'))

    expect(screen.getByText('Digite um nome para buscar ou cadastrar')).toBeInTheDocument()
  })

  it('hides the empty hint once the operator starts typing', async () => {
    render(<Harness rows={[]} emptyHint="Digite um nome para buscar ou cadastrar" />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'a')

    expect(screen.queryByText('Digite um nome para buscar ou cadastrar')).not.toBeInTheDocument()
  })
})
