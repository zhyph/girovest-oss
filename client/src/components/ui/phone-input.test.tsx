import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PhoneInput } from './phone-input.tsx'

describe('PhoneInput', () => {
  it('formats a stored 11-digit mobile number as (DDD) NNNNN-NNNN', () => {
    render(<PhoneInput value="11987654321" onChange={vi.fn()} aria-label="Telefone" />)
    expect(screen.getByLabelText('Telefone')).toHaveValue('(11) 98765-4321')
  })

  it('formats a stored 10-digit landline number as (DDD) NNNN-NNNN', () => {
    render(<PhoneInput value="1132654321" onChange={vi.fn()} aria-label="Telefone" />)
    expect(screen.getByLabelText('Telefone')).toHaveValue('(11) 3265-4321')
  })

  it('emits the fully formatted mask as digits accumulate', async () => {
    const onChange = vi.fn()
    render(<PhoneInput value="" onChange={onChange} aria-label="Telefone" />)

    await userEvent.type(screen.getByLabelText('Telefone'), '11987654321')

    expect(onChange).toHaveBeenLastCalledWith('(11) 98765-4321')
  })

  it('has no letters or symbols enforced by type, but is a tel input', () => {
    render(<PhoneInput value="" onChange={vi.fn()} aria-label="Telefone" />)
    expect(screen.getByLabelText('Telefone')).toHaveAttribute('type', 'tel')
  })
})
