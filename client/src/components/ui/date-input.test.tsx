import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateInput } from './date-input.tsx'

describe('DateInput', () => {
  it('formats a stored ISO date as DD/MM/AAAA regardless of OS locale', () => {
    render(<DateInput value="2026-08-23" onChange={vi.fn()} aria-label="Data" />)
    expect(screen.getByLabelText('Data')).toHaveValue('23/08/2026')
  })

  it('shows a partial mask while digits are still being typed', async () => {
    const onChange = vi.fn()
    render(<DateInput value="" onChange={onChange} aria-label="Data" />)

    await userEvent.type(screen.getByLabelText('Data'), '2308')

    expect(screen.getByLabelText('Data')).toHaveValue('23/08')
  })

  it('emits a YYYY-MM-DD value once all 8 digits are entered', async () => {
    const onChange = vi.fn()
    render(<DateInput value="" onChange={onChange} aria-label="Data" />)

    await userEvent.type(screen.getByLabelText('Data'), '23082026')

    expect(onChange).toHaveBeenLastCalledWith('2026-08-23')
  })

  it('is a plain text input (no native date picker, no OS-locale display)', () => {
    render(<DateInput value="" onChange={vi.fn()} aria-label="Data" />)
    expect(screen.getByLabelText('Data')).toHaveAttribute('type', 'text')
  })
})
