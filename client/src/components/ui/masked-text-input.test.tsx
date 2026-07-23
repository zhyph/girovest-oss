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
})
