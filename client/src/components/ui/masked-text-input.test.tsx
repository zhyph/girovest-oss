import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaskedTextInput } from './masked-text-input.tsx'

describe('MaskedTextInput', () => {
  it('renders the value as plain text when no mask is given', () => {
    render(<MaskedTextInput value="hello" onChange={vi.fn()} aria-label="Campo" />)
    expect(screen.getByLabelText('Campo')).toHaveValue('hello')
  })

  it('applies the given mask function to the displayed value', () => {
    const mask = (raw: string) => raw.toUpperCase()
    render(<MaskedTextInput value="abc" onChange={vi.fn()} mask={mask} aria-label="Campo" />)
    expect(screen.getByLabelText('Campo')).toHaveValue('ABC')
  })

  it('applies the mask to typed input and emits the masked value via onChange', async () => {
    const mask = (raw: string) => raw.toUpperCase()
    const onChange = vi.fn()
    render(<MaskedTextInput value="" onChange={onChange} mask={mask} aria-label="Campo" />)

    await userEvent.type(screen.getByLabelText('Campo'), 'abc')

    expect(onChange).toHaveBeenLastCalledWith('ABC')
  })

  it('is a plain text input', () => {
    render(<MaskedTextInput value="" onChange={vi.fn()} aria-label="Campo" />)
    expect(screen.getByLabelText('Campo')).toHaveAttribute('type', 'text')
  })

  it('CRITICAL: keeps the caret where she is editing, mid-value', async () => {
    // Setting `value` on a controlled input parks the caret at the end, so
    // correcting one digit in the middle of a CPF threw the cursor past the
    // check digits — she deleted all eleven and retyped them.
    // The real CPF mask, from the app's own field masks.
    const cpfMask = (raw: string) => {
      const digits = raw.replace(/\D/g, '').slice(0, 11)
      return digits
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4')
    }
    function Host() {
      const [value, setValue] = useState('123.456.789-00')
      return <MaskedTextInput value={value} onChange={setValue} mask={cpfMask} aria-label="CPF" />
    }
    render(<Host />)
    const field = screen.getByLabelText('CPF') as HTMLInputElement

    field.setSelectionRange(5, 5)
    await userEvent.type(field, '9', { initialSelectionStart: 5, initialSelectionEnd: 5 })

    // Exactly after the digit she typed. `< value.length` would also pass at
    // 13, which is most of the way to the end and not what "in place" means.
    expect(field.selectionStart).toBe(6)
  })

  it('CRITICAL: leaves free text alone — an unmasked field needs no restoration', async () => {
    // Counting mask-significant characters is only meaningful for a mask that
    // inserts separators. Applied to free text it jumped the caret over every
    // character it did not count, so "SSP/SP" typed out as "SSPSP/" and
    // "Certidão 2024" as "Certido2024 ã" — every user-added document row is
    // unmasked, so this hit exactly the fields people type prose into.
    function Host() {
      const [value, setValue] = useState('')
      return <MaskedTextInput value={value} onChange={setValue} aria-label="Órgão" />
    }
    render(<Host />)
    const field = screen.getByLabelText('Órgão') as HTMLInputElement

    await userEvent.type(field, 'SSP/SP')
    expect(field.value).toBe('SSP/SP')

    await userEvent.clear(field)
    await userEvent.type(field, 'Certidão 2024')
    expect(field.value).toBe('Certidão 2024')
  })

  it('does not yank the caret on a later render when the mask swallowed the edit', async () => {
    // A letter typed into a numeric mask produces an identical string, so no
    // render commits and a stored caret target would be applied to some
    // unrelated render afterwards.
    function Host() {
      const [value, setValue] = useState('123')
      return (
        <>
          <MaskedTextInput value={value} onChange={setValue} mask={(raw) => raw.replace(/\D/g, '')} aria-label="Num" />
          <button type="button" onClick={() => setValue((current) => current)}>
            re-render
          </button>
        </>
      )
    }
    render(<Host />)
    const field = screen.getByLabelText('Num') as HTMLInputElement

    await userEvent.type(field, 'x', { initialSelectionStart: 3, initialSelectionEnd: 3 })
    field.setSelectionRange(1, 1)
    await userEvent.click(screen.getByRole('button', { name: 're-render' }))

    expect(field.selectionStart).toBe(1)
  })
})
