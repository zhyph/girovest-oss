import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AutocompleteInput } from './autocomplete-input.tsx'

const SUGGESTIONS = ['Festa', 'Infantil', 'Madrinha', 'Noiva']

/** Lets a test shrink the suggestion list the way a background refetch would. */
function ShrinkingHarness({ onChange }: { onChange: (v: string) => void }) {
  const [suggestions, setSuggestions] = useState(SUGGESTIONS)
  const [value, setValue] = useState('')
  return (
    <>
      <AutocompleteInput
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
        suggestions={suggestions}
        aria-label="Categoria"
      />
      <button type="button" onClick={() => setSuggestions(['Festa'])}>
        encolher
      </button>
    </>
  )
}

function Harness({ suggestions = SUGGESTIONS, onChange }: { suggestions?: string[]; onChange?: (v: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <AutocompleteInput
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
      suggestions={suggestions}
      aria-label="Categoria"
    />
  )
}

describe('AutocompleteInput', () => {
  it('offers the values already in use once the field is focused', async () => {
    render(<Harness />)

    await userEvent.click(screen.getByLabelText('Categoria'))

    expect(screen.getByRole('option', { name: 'Festa' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Noiva' })).toBeInTheDocument()
  })

  it('narrows the list as the operator types, ignoring case and accents', async () => {
    render(<Harness suggestions={['Festa', 'Infantil', 'Cerimônia']} />)

    await userEvent.type(screen.getByLabelText('Categoria'), 'cerimon')

    expect(screen.getByRole('option', { name: 'Cerimônia' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Festa' })).not.toBeInTheDocument()
  })

  it('fills the field when a suggestion is clicked', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('Categoria'))

    await userEvent.click(screen.getByRole('option', { name: 'Madrinha' }))

    expect(screen.getByLabelText('Categoria')).toHaveValue('Madrinha')
  })

  it('accepts a value that is not in the list at all', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await userEvent.type(screen.getByLabelText('Categoria'), 'Debutante')

    expect(screen.getByLabelText('Categoria')).toHaveValue('Debutante')
    // Nothing matches, so no list is in the way of just saving what was typed.
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('picks the highlighted suggestion with the keyboard', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('Categoria'))

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(screen.getByLabelText('Categoria')).toHaveValue('Infantil')
  })

  it('stops suggesting once the field already says the value exactly', async () => {
    render(<Harness />)

    await userEvent.type(screen.getByLabelText('Categoria'), 'Festa')

    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('still offers a longer suggestion that also matches an exact-match query', async () => {
    render(<Harness suggestions={['Festa', 'Festa Junina']} />)

    await userEvent.type(screen.getByLabelText('Categoria'), 'Festa')

    expect(screen.queryByRole('option', { name: 'Festa' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Festa Junina' })).toBeInTheDocument()
  })

  it('shows each repeated value only once', async () => {
    render(<Harness suggestions={['Festa', 'festa', 'FESTA', 'Noiva']} />)

    await userEvent.click(screen.getByLabelText('Categoria'))

    expect(screen.getAllByRole('option', { name: /festa/i })).toHaveLength(1)
  })
  it('marks the active option for screen readers while focus stays in the field', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('Categoria'))

    await userEvent.keyboard('{ArrowDown}')

    const input = screen.getByLabelText('Categoria')
    const active = screen.getByRole('option', { name: 'Festa' })
    expect(input).toHaveFocus()
    expect(input).toHaveAttribute('aria-activedescendant', active.id)
  })

  it('does not blank the field when the suggestion list shrinks under the highlight', async () => {
    // The products query refetches on window focus and on any allocation
    // mutation, so the list can shrink while an operator holds a highlight.
    const onChange = vi.fn()
    render(<ShrinkingHarness onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('Categoria'))
    // Hold the 4th suggestion, then let the list collapse to a single entry.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}')
    await userEvent.click(screen.getByRole('button', { name: 'encolher' }))

    await userEvent.click(screen.getByLabelText('Categoria'))
    await userEvent.keyboard('{Enter}')

    // Reading the stale index would hand `undefined` to the form field.
    for (const [emitted] of onChange.mock.calls) {
      expect(typeof emitted).toBe('string')
    }
  })
})
