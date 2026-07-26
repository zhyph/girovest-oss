import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select } from './select.tsx'

describe('Select', () => {
  it('renders its options and reflects a user selection', async () => {
    render(
      <Select aria-label="Tamanho" defaultValue="">
        <option value="">—</option>
        <option value="p">P</option>
        <option value="m">M</option>
      </Select>,
    )
    const select = screen.getByRole('combobox', { name: 'Tamanho' })
    await userEvent.selectOptions(select, 'm')
    expect(select).toHaveValue('m')
  })

  it('applies the shared form-control token classes', () => {
    render(
      <Select aria-label="Status">
        <option>ativo</option>
      </Select>,
    )
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveClass(
      'border-input',
      'bg-card',
      'aria-invalid:border-destructive',
    )
  })

  it('merges a caller-supplied className', () => {
    render(
      <Select aria-label="Cliente" className="w-40">
        <option>a</option>
      </Select>,
    )
    expect(screen.getByRole('combobox', { name: 'Cliente' })).toHaveClass('w-40')
  })
})
