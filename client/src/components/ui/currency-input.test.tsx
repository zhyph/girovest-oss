import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CurrencyInput } from './currency-input.tsx'

describe('CurrencyInput', () => {
  it('formats an initial numeric value as BRL currency text', () => {
    render(<CurrencyInput value={1234.5} onChange={vi.fn()} aria-label="Preço" />)
    // Node's ICU renders a non-breaking space (U+00A0) between "R$" and the
    // amount, not a regular space — assert against the real formatter output
    // rather than a hand-typed literal that would silently mismatch on that byte.
    const expected = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(1234.5)
    expect(screen.getByLabelText('Preço')).toHaveValue(expected)
  })

  it('parses typed digits back into a plain number on change', async () => {
    const onChange = vi.fn()
    render(<CurrencyInput value={0} onChange={onChange} aria-label="Preço" />)

    const input = screen.getByLabelText('Preço')
    await userEvent.clear(input)
    // Digit-tracking (POS-style) input: typed digits accumulate as cents, so
    // "15000" produces 150.00 (R$ 150,00), matching the component's documented behavior.
    await userEvent.type(input, '15000')

    expect(onChange).toHaveBeenLastCalledWith(150)
  })

  it('has no native number-input spinner arrows (it is a text input under the hood)', () => {
    render(<CurrencyInput value={0} onChange={vi.fn()} aria-label="Preço" />)
    expect(screen.getByLabelText('Preço')).toHaveAttribute('type', 'text')
  })
})
